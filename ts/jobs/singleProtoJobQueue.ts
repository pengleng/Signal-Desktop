// Copyright 2022 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import PQueue from 'p-queue';

import * as Bytes from '../Bytes';
import type { LoggerType } from '../types/Logging';
import { exponentialBackoffMaxAttempts } from '../util/exponentialBackoff';
import type { ParsedJob } from './types';
import { JobQueue } from './JobQueue';
import { jobQueueDatabaseStore } from './JobQueueDatabaseStore';
import { DAY } from '../util/durations';
import { commonShouldJobContinue } from './helpers/commonShouldJobContinue';
import { SignalService as Proto } from '../protobuf';
import { handleMessageSend } from '../util/handleMessageSend';
import { getSendOptions } from '../util/getSendOptions';
import type { SingleProtoJobData } from '../textsecure/SendMessage';
import { singleProtoJobDataSchema } from '../textsecure/SendMessage';
import {
  handleMultipleSendErrors,
  maybeExpandErrors,
} from './helpers/handleMultipleSendErrors';
import { isConversationUnregistered } from '../util/isConversationUnregistered';
import { isConversationAccepted } from '../util/isConversationAccepted';

const MAX_RETRY_TIME = DAY;
const MAX_PARALLEL_JOBS = 5;
const MAX_ATTEMPTS = exponentialBackoffMaxAttempts(MAX_RETRY_TIME);

export class SingleProtoJobQueue extends JobQueue<SingleProtoJobData> {
  private parallelQueue = new PQueue({ concurrency: MAX_PARALLEL_JOBS });

  protected override getInMemoryQueue(
    _parsedJob: ParsedJob<SingleProtoJobData>
  ): PQueue {
    return this.parallelQueue;
  }

  protected parseData(data: unknown): SingleProtoJobData {
    return singleProtoJobDataSchema.parse(data);
  }

  protected async run(
    {
      data,
      timestamp,
    }: Readonly<{ data: SingleProtoJobData; timestamp: number }>,
    { attempt, log }: Readonly<{ attempt: number; log: LoggerType }>
  ): Promise<void> {
    const timeRemaining = timestamp + MAX_RETRY_TIME - Date.now();
    const isFinalAttempt = attempt >= MAX_ATTEMPTS;

    const shouldContinue = await commonShouldJobContinue({
      attempt,
      log,
      timeRemaining,
      skipWait: false,
    });
    if (!shouldContinue) {
      return;
    }

    const {
      contentHint,
      identifier,
      isSyncMessage,
      messageIds = [],
      protoBase64,
      type,
    } = data;
    log.info(
      `starting ${type} send to ${identifier} with timestamp ${timestamp}`
    );

    const conversation = window.ConversationController.get(identifier);
    if (!conversation) {
      throw new Error(
        `Failed to get conversation for identifier ${identifier}`
      );
    }

    if (!isConversationAccepted(conversation.attributes)) {
      log.info(
        `conversation ${conversation.idForLogging()} is not accepted; refusing to send`
      );
      return;
    }
    if (isConversationUnregistered(conversation.attributes)) {
      log.info(
        `conversation ${conversation.idForLogging()} is unregistered; refusing to send`
      );
      return;
    }
    if (conversation.isBlocked()) {
      log.info(
        `conversation ${conversation.idForLogging()} is blocked; refusing to send`
      );
      return;
    }

    const proto = Proto.Content.decode(Bytes.fromBase64(protoBase64));
    const options = await getSendOptions(conversation.attributes, {
      syncMessage: isSyncMessage,
    });

    try {
      await handleMessageSend(
        window.textsecure.messaging.sendIndividualProto({
          contentHint,
          identifier,
          options,
          proto,
          timestamp,
        }),
        { messageIds, sendType: type }
      );
    } catch (error: unknown) {
      await handleMultipleSendErrors({
        errors: maybeExpandErrors(error),
        isFinalAttempt,
        log,
        timeRemaining,
        toThrow: error,
      });
    }
  }
}

export const singleProtoJobQueue = new SingleProtoJobQueue({
  maxAttempts: MAX_ATTEMPTS,
  queueType: 'single proto',
  store: jobQueueDatabaseStore,
});
