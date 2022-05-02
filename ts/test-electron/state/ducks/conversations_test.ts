// Copyright 2020-2022 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';
import * as sinon from 'sinon';
import { v4 as uuid } from 'uuid';
import { times } from 'lodash';
import { reducer as rootReducer } from '../../../state/reducer';
import { noopAction } from '../../../state/ducks/noop';
import {
  ComposerStep,
  ConversationVerificationState,
  OneTimeModalState,
} from '../../../state/ducks/conversationsEnums';
import type {
  CancelVerificationDataByConversationActionType,
  ConversationMessageType,
  ConversationsStateType,
  ConversationType,
  MessageType,
  SwitchToAssociatedViewActionType,
  ToggleConversationInChooseMembersActionType,
} from '../../../state/ducks/conversations';
import {
  actions,
  cancelConversationVerification,
  clearCancelledConversationVerification,
  getConversationCallMode,
  getEmptyState,
  reducer,
  updateConversationLookups,
} from '../../../state/ducks/conversations';
import { ReadStatus } from '../../../messages/MessageReadStatus';
import { ContactSpoofingType } from '../../../util/contactSpoofing';
import { CallMode } from '../../../types/Calling';
import { UUID } from '../../../types/UUID';
import {
  getDefaultConversation,
  getDefaultConversationWithUuid,
} from '../../../test-both/helpers/getDefaultConversation';
import { getDefaultAvatars } from '../../../types/Avatar';
import {
  defaultStartDirectConversationComposerState,
  defaultChooseGroupMembersComposerState,
  defaultSetGroupMetadataComposerState,
} from '../../../test-both/helpers/defaultComposerStates';
import { updateRemoteConfig } from '../../../test-both/helpers/RemoteConfigStub';

const {
  clearGroupCreationError,
  clearInvitedUuidsForNewlyCreatedGroup,
  closeContactSpoofingReview,
  closeMaximumGroupSizeModal,
  closeRecommendedGroupSizeModal,
  conversationStoppedByMissingVerification,
  createGroup,
  openConversationInternal,
  repairNewestMessage,
  repairOldestMessage,
  setComposeGroupAvatar,
  setComposeGroupName,
  setComposeSearchTerm,
  setPreJoinConversation,
  showArchivedConversations,
  showInbox,
  startComposing,
  showChooseGroupMembers,
  startSettingGroupMetadata,
  resetAllChatColors,
  reviewGroupMemberNameCollision,
  reviewMessageRequestNameCollision,
  toggleConversationInChooseMembers,
} = actions;

describe('both/state/ducks/conversations', () => {
  const getEmptyRootState = () => rootReducer(undefined, noopAction());

  let sinonSandbox: sinon.SinonSandbox;
  let createGroupStub: sinon.SinonStub;

  beforeEach(() => {
    sinonSandbox = sinon.createSandbox();

    sinonSandbox.stub(window.Whisper.events, 'trigger');

    createGroupStub = sinon.stub();
  });

  afterEach(() => {
    sinonSandbox.restore();
  });

  describe('helpers', () => {
    describe('getConversationCallMode', () => {
      const fakeConversation: ConversationType = getDefaultConversation();

      it("returns CallMode.None if you've left the conversation", () => {
        assert.strictEqual(
          getConversationCallMode({
            ...fakeConversation,
            left: true,
          }),
          CallMode.None
        );
      });

      it("returns CallMode.None if you've blocked the other person", () => {
        assert.strictEqual(
          getConversationCallMode({
            ...fakeConversation,
            isBlocked: true,
          }),
          CallMode.None
        );
      });

      it("returns CallMode.None if you haven't accepted message requests", () => {
        assert.strictEqual(
          getConversationCallMode({
            ...fakeConversation,
            acceptedMessageRequest: false,
          }),
          CallMode.None
        );
      });

      it('returns CallMode.None if the conversation is Note to Self', () => {
        assert.strictEqual(
          getConversationCallMode({
            ...fakeConversation,
            isMe: true,
          }),
          CallMode.None
        );
      });

      it('returns CallMode.None for v1 groups', () => {
        assert.strictEqual(
          getConversationCallMode({
            ...fakeConversation,
            type: 'group',
            groupVersion: 1,
            sharedGroupNames: [],
          }),
          CallMode.None
        );

        assert.strictEqual(
          getConversationCallMode({
            ...fakeConversation,
            type: 'group',
            sharedGroupNames: [],
          }),
          CallMode.None
        );
      });

      it('returns CallMode.Direct if the conversation is a normal direct conversation', () => {
        assert.strictEqual(
          getConversationCallMode(fakeConversation),
          CallMode.Direct
        );
      });

      it('returns CallMode.Group if the conversation is a v2 group', () => {
        assert.strictEqual(
          getConversationCallMode({
            ...fakeConversation,
            type: 'group',
            groupVersion: 2,
            sharedGroupNames: [],
          }),
          CallMode.Group
        );
      });
    });

    describe('updateConversationLookups', () => {
      it('does not change lookups if no conversations provided', () => {
        const state = getEmptyState();
        const result = updateConversationLookups(undefined, undefined, state);

        assert.strictEqual(
          state.conversationsByE164,
          result.conversationsByE164
        );
        assert.strictEqual(
          state.conversationsByUuid,
          result.conversationsByUuid
        );
        assert.strictEqual(
          state.conversationsByGroupId,
          result.conversationsByGroupId
        );
      });

      it('adds and removes e164-only contact', () => {
        const removed = getDefaultConversation({
          id: 'id-removed',
          e164: 'e164-removed',
          uuid: undefined,
        });

        const state = {
          ...getEmptyState(),
          conversationsByE164: {
            'e164-removed': removed,
          },
        };
        const added = getDefaultConversation({
          id: 'id-added',
          e164: 'e164-added',
          uuid: undefined,
        });

        const expected = {
          'e164-added': added,
        };

        const actual = updateConversationLookups(added, removed, state);

        assert.deepEqual(actual.conversationsByE164, expected);
        assert.strictEqual(
          state.conversationsByUuid,
          actual.conversationsByUuid
        );
        assert.strictEqual(
          state.conversationsByGroupId,
          actual.conversationsByGroupId
        );
      });

      it('adds and removes uuid-only contact', () => {
        const removed = getDefaultConversationWithUuid({
          id: 'id-removed',
          e164: undefined,
        });

        const state = {
          ...getEmptyState(),
          conversationsByuuid: {
            [removed.uuid]: removed,
          },
        };
        const added = getDefaultConversationWithUuid({
          id: 'id-added',
          e164: undefined,
        });

        const expected = {
          [added.uuid]: added,
        };

        const actual = updateConversationLookups(added, removed, state);

        assert.strictEqual(
          state.conversationsByE164,
          actual.conversationsByE164
        );
        assert.deepEqual(actual.conversationsByUuid, expected);
        assert.strictEqual(
          state.conversationsByGroupId,
          actual.conversationsByGroupId
        );
      });

      it('adds and removes groupId-only contact', () => {
        const removed = getDefaultConversation({
          id: 'id-removed',
          groupId: 'groupId-removed',
          e164: undefined,
          uuid: undefined,
        });

        const state = {
          ...getEmptyState(),
          conversationsBygroupId: {
            'groupId-removed': removed,
          },
        };
        const added = getDefaultConversation({
          id: 'id-added',
          groupId: 'groupId-added',
          e164: undefined,
          uuid: undefined,
        });

        const expected = {
          'groupId-added': added,
        };

        const actual = updateConversationLookups(added, removed, state);

        assert.strictEqual(
          state.conversationsByE164,
          actual.conversationsByE164
        );
        assert.strictEqual(
          state.conversationsByUuid,
          actual.conversationsByUuid
        );
        assert.deepEqual(actual.conversationsByGroupId, expected);
      });
    });
  });

  describe('reducer', () => {
    const time = Date.now();
    const previousTime = time - 1;
    const conversationId = 'conversation-guid-1';
    const messageId = 'message-guid-1';
    const messageIdTwo = 'message-guid-2';
    const messageIdThree = 'message-guid-3';
    const sourceUuid = UUID.generate().toString();

    function getDefaultMessage(id: string): MessageType {
      return {
        attachments: [],
        conversationId: 'conversationId',
        id,
        received_at: previousTime,
        sent_at: previousTime,
        source: 'source',
        sourceUuid,
        timestamp: previousTime,
        type: 'incoming' as const,
        readStatus: ReadStatus.Read,
      };
    }

    function getDefaultConversationMessage(): ConversationMessageType {
      return {
        messageIds: [],
        metrics: {
          totalUnseen: 0,
        },
        scrollToMessageCounter: 0,
      };
    }

    describe('openConversationInternal', () => {
      it("returns a thunk that triggers a 'showConversation' event when passed a conversation ID", () => {
        const dispatch = sinon.spy();

        openConversationInternal({ conversationId: 'abc123' })(
          dispatch,
          getEmptyRootState,
          null
        );

        sinon.assert.calledOnce(
          window.Whisper.events.trigger as sinon.SinonSpy
        );
        sinon.assert.calledWith(
          window.Whisper.events.trigger as sinon.SinonSpy,
          'showConversation',
          'abc123',
          undefined
        );
      });

      it("returns a thunk that triggers a 'showConversation' event when passed a conversation ID and message ID", () => {
        const dispatch = sinon.spy();

        openConversationInternal({
          conversationId: 'abc123',
          messageId: 'xyz987',
        })(dispatch, getEmptyRootState, null);

        sinon.assert.calledOnce(
          window.Whisper.events.trigger as sinon.SinonSpy
        );
        sinon.assert.calledWith(
          window.Whisper.events.trigger as sinon.SinonSpy,
          'showConversation',
          'abc123',
          'xyz987'
        );
      });

      it("returns a thunk that doesn't dispatch any actions by default", () => {
        const dispatch = sinon.spy();

        openConversationInternal({ conversationId: 'abc123' })(
          dispatch,
          getEmptyRootState,
          null
        );

        sinon.assert.notCalled(dispatch);
      });

      it('dispatches a SWITCH_TO_ASSOCIATED_VIEW action if called with a flag', () => {
        const dispatch = sinon.spy();

        openConversationInternal({
          conversationId: 'abc123',
          switchToAssociatedView: true,
        })(dispatch, getEmptyRootState, null);

        sinon.assert.calledWith(dispatch, {
          type: 'SWITCH_TO_ASSOCIATED_VIEW',
          payload: { conversationId: 'abc123' },
        });
      });

      describe('SWITCH_TO_ASSOCIATED_VIEW', () => {
        let action: SwitchToAssociatedViewActionType;

        beforeEach(() => {
          const dispatch = sinon.spy();
          openConversationInternal({
            conversationId: 'fake-conversation-id',
            switchToAssociatedView: true,
          })(dispatch, getEmptyRootState, null);
          [action] = dispatch.getCall(0).args;
        });

        it('shows the inbox if the conversation is not archived', () => {
          const conversation = getDefaultConversation({
            id: 'fake-conversation-id',
          });
          const state = {
            ...getEmptyState(),
            conversationLookup: {
              [conversation.id]: conversation,
            },
          };
          const result = reducer(state, action);

          assert.isUndefined(result.composer);
          assert.isFalse(result.showArchived);
        });

        it('shows the archive if the conversation is archived', () => {
          const conversation = getDefaultConversation({
            id: 'fake-conversation-id',
            isArchived: true,
          });
          const state = {
            ...getEmptyState(),
            conversationLookup: {
              [conversation.id]: conversation,
            },
          };
          const result = reducer(state, action);

          assert.isUndefined(result.composer);
          assert.isTrue(result.showArchived);
        });

        it('does nothing if the conversation is not found', () => {
          const state = getEmptyState();
          const result = reducer(state, action);

          assert.strictEqual(result, state);
        });
      });
    });

    describe('CLEAR_GROUP_CREATION_ERROR', () => {
      it('clears the group creation error', () => {
        const state = {
          ...getEmptyState(),
          composer: {
            ...defaultSetGroupMetadataComposerState,
            hasError: true as const,
          },
        };
        const action = clearGroupCreationError();
        const result = reducer(state, action);

        assert(
          result.composer?.step === ComposerStep.SetGroupMetadata &&
            result.composer.hasError === false
        );
      });
    });

    describe('CLEAR_INVITED_UUIDS_FOR_NEWLY_CREATED_GROUP', () => {
      it('clears the list of invited conversation UUIDs', () => {
        const state = {
          ...getEmptyState(),
          invitedUuidsForNewlyCreatedGroup: [
            UUID.generate().toString(),
            UUID.generate().toString(),
          ],
        };
        const action = clearInvitedUuidsForNewlyCreatedGroup();
        const result = reducer(state, action);

        assert.isUndefined(result.invitedUuidsForNewlyCreatedGroup);
      });
    });

    describe('CLOSE_CONTACT_SPOOFING_REVIEW', () => {
      it('closes the contact spoofing review modal if it was open', () => {
        const state = {
          ...getEmptyState(),
          contactSpoofingReview: {
            type: ContactSpoofingType.DirectConversationWithSameTitle as const,
            safeConversationId: 'abc123',
          },
        };
        const action = closeContactSpoofingReview();
        const actual = reducer(state, action);

        assert.isUndefined(actual.contactSpoofingReview);
      });

      it("does nothing if the modal wasn't already open", () => {
        const state = getEmptyState();
        const action = closeContactSpoofingReview();
        const actual = reducer(state, action);

        assert.deepEqual(actual, state);
      });
    });

    describe('CLOSE_MAXIMUM_GROUP_SIZE_MODAL', () => {
      it('closes the maximum group size modal if it was open', () => {
        const state = {
          ...getEmptyState(),
          composer: {
            ...defaultChooseGroupMembersComposerState,
            maximumGroupSizeModalState: OneTimeModalState.Showing,
          },
        };
        const action = closeMaximumGroupSizeModal();
        const result = reducer(state, action);

        assert(
          result.composer?.step === ComposerStep.ChooseGroupMembers &&
            result.composer.maximumGroupSizeModalState ===
              OneTimeModalState.Shown,
          'Expected the modal to be closed'
        );
      });

      it('does nothing if the maximum group size modal was never shown', () => {
        const state = {
          ...getEmptyState(),
          composer: defaultChooseGroupMembersComposerState,
        };
        const action = closeMaximumGroupSizeModal();
        const result = reducer(state, action);

        assert.strictEqual(result, state);
      });

      it('does nothing if the maximum group size modal already closed', () => {
        const state = {
          ...getEmptyState(),
          composer: {
            ...defaultChooseGroupMembersComposerState,
            maximumGroupSizeModalState: OneTimeModalState.Shown,
          },
        };
        const action = closeMaximumGroupSizeModal();
        const result = reducer(state, action);

        assert.strictEqual(result, state);
      });
    });

    describe('CLOSE_RECOMMENDED_GROUP_SIZE_MODAL', () => {
      it('closes the recommended group size modal if it was open', () => {
        const state = {
          ...getEmptyState(),
          composer: {
            ...defaultChooseGroupMembersComposerState,
            recommendedGroupSizeModalState: OneTimeModalState.Showing,
          },
        };
        const action = closeRecommendedGroupSizeModal();
        const result = reducer(state, action);

        assert(
          result.composer?.step === ComposerStep.ChooseGroupMembers &&
            result.composer.recommendedGroupSizeModalState ===
              OneTimeModalState.Shown,
          'Expected the modal to be closed'
        );
      });

      it('does nothing if the recommended group size modal was never shown', () => {
        const state = {
          ...getEmptyState(),
          composer: defaultChooseGroupMembersComposerState,
        };
        const action = closeRecommendedGroupSizeModal();
        const result = reducer(state, action);

        assert.strictEqual(result, state);
      });

      it('does nothing if the recommended group size modal already closed', () => {
        const state = {
          ...getEmptyState(),
          composer: {
            ...defaultChooseGroupMembersComposerState,
            recommendedGroupSizeModalState: OneTimeModalState.Shown,
          },
        };
        const action = closeRecommendedGroupSizeModal();
        const result = reducer(state, action);

        assert.strictEqual(result, state);
      });
    });

    describe('createGroup', () => {
      const conversationsState = {
        ...getEmptyState(),
        composer: {
          ...defaultSetGroupMetadataComposerState,
          selectedConversationIds: ['abc123'],
          groupName: 'Foo Bar Group',
          groupAvatar: new Uint8Array([1, 2, 3]),
        },
      };

      it('immediately dispatches a CREATE_GROUP_PENDING action, which puts the composer in a loading state', () => {
        const dispatch = sinon.spy();

        createGroup()(
          dispatch,
          () => ({
            ...getEmptyRootState(),
            conversations: conversationsState,
          }),
          null
        );

        sinon.assert.calledOnce(dispatch);
        sinon.assert.calledWith(dispatch, { type: 'CREATE_GROUP_PENDING' });

        const action = dispatch.getCall(0).args[0];

        const result = reducer(conversationsState, action);

        assert(
          result.composer?.step === ComposerStep.SetGroupMetadata &&
            result.composer.isCreating &&
            !result.composer.hasError
        );
      });

      it('calls groups.createGroupV2', async () => {
        await createGroup(createGroupStub)(
          sinon.spy(),
          () => ({
            ...getEmptyRootState(),
            conversations: conversationsState,
          }),
          null
        );

        sinon.assert.calledOnce(createGroupStub);
        sinon.assert.calledWith(createGroupStub, {
          name: 'Foo Bar Group',
          avatar: new Uint8Array([1, 2, 3]),
          avatars: [],
          expireTimer: 0,
          conversationIds: ['abc123'],
        });
      });

      it("trims the group's title before calling groups.createGroupV2", async () => {
        await createGroup(createGroupStub)(
          sinon.spy(),
          () => ({
            ...getEmptyRootState(),
            conversations: {
              ...conversationsState,
              composer: {
                ...conversationsState.composer,
                groupName: '  To  Trim \t',
              },
            },
          }),
          null
        );

        sinon.assert.calledWith(
          createGroupStub,
          sinon.match({ name: 'To  Trim' })
        );
      });

      it('dispatches a CREATE_GROUP_REJECTED action if group creation fails, which marks the state with an error', async () => {
        createGroupStub.rejects(new Error('uh oh'));

        const dispatch = sinon.spy();

        const createGroupPromise = createGroup(createGroupStub)(
          dispatch,
          () => ({
            ...getEmptyRootState(),
            conversations: conversationsState,
          }),
          null
        );

        const pendingAction = dispatch.getCall(0).args[0];
        const stateAfterPending = reducer(conversationsState, pendingAction);

        await createGroupPromise;

        sinon.assert.calledTwice(dispatch);
        sinon.assert.calledWith(dispatch, { type: 'CREATE_GROUP_REJECTED' });

        const rejectedAction = dispatch.getCall(1).args[0];
        const result = reducer(stateAfterPending, rejectedAction);

        assert(
          result.composer?.step === ComposerStep.SetGroupMetadata &&
            !result.composer.isCreating &&
            result.composer.hasError
        );
      });

      it("when rejecting, does nothing to the left pane if it's no longer in this composer state", async () => {
        createGroupStub.rejects(new Error('uh oh'));

        const dispatch = sinon.spy();

        const createGroupPromise = createGroup(createGroupStub)(
          dispatch,
          () => ({
            ...getEmptyRootState(),
            conversations: conversationsState,
          }),
          null
        );

        await createGroupPromise;

        const state = getEmptyState();
        const rejectedAction = dispatch.getCall(1).args[0];
        const result = reducer(state, rejectedAction);

        assert.strictEqual(result, state);
      });

      it('dispatches a CREATE_GROUP_FULFILLED event (which updates the newly-created conversation IDs), triggers a showConversation event and switches to the associated conversation on success', async () => {
        const abc = UUID.fromPrefix('abc').toString();
        createGroupStub.resolves({
          id: '9876',
          get: (key: string) => {
            if (key !== 'pendingMembersV2') {
              throw new Error('This getter is not set up for this test');
            }
            return [{ uuid: abc }];
          },
        });

        const dispatch = sinon.spy();

        await createGroup(createGroupStub)(
          dispatch,
          () => ({
            ...getEmptyRootState(),
            conversations: conversationsState,
          }),
          null
        );

        sinon.assert.calledWith(
          window.Whisper.events.trigger as sinon.SinonSpy,
          'showConversation',
          '9876',
          undefined
        );

        sinon.assert.calledWith(dispatch, {
          type: 'CREATE_GROUP_FULFILLED',
          payload: { invitedUuids: [abc] },
        });

        const fulfilledAction = dispatch.getCall(1).args[0];
        const result = reducer(conversationsState, fulfilledAction);
        assert.deepEqual(result.invitedUuidsForNewlyCreatedGroup, [abc]);

        sinon.assert.calledWith(dispatch, {
          type: 'SWITCH_TO_ASSOCIATED_VIEW',
          payload: { conversationId: '9876' },
        });
      });
    });

    describe('CONVERSATION_STOPPED_BY_MISSING_VERIFICATION', () => {
      it('adds to state, removing duplicates', () => {
        const first = reducer(
          getEmptyState(),
          conversationStoppedByMissingVerification({
            conversationId: 'convo A',
            untrustedConversationIds: ['convo 1'],
          })
        );
        const second = reducer(
          first,
          conversationStoppedByMissingVerification({
            conversationId: 'convo A',
            untrustedConversationIds: ['convo 2'],
          })
        );
        const third = reducer(
          second,
          conversationStoppedByMissingVerification({
            conversationId: 'convo A',
            untrustedConversationIds: ['convo 1', 'convo 3'],
          })
        );

        assert.deepStrictEqual(third.verificationDataByConversation, {
          'convo A': {
            type: ConversationVerificationState.PendingVerification,
            conversationsNeedingVerification: ['convo 1', 'convo 2', 'convo 3'],
          },
        });
      });

      it('stomps on VerificationCancelled state', () => {
        const state: ConversationsStateType = {
          ...getEmptyState(),
          verificationDataByConversation: {
            'convo A': {
              type: ConversationVerificationState.VerificationCancelled,
              canceledAt: Date.now(),
            },
          },
        };
        const actual = reducer(
          state,
          conversationStoppedByMissingVerification({
            conversationId: 'convo A',
            untrustedConversationIds: ['convo 1', 'convo 2'],
          })
        );

        assert.deepStrictEqual(actual.verificationDataByConversation, {
          'convo A': {
            type: ConversationVerificationState.PendingVerification,
            conversationsNeedingVerification: ['convo 1', 'convo 2'],
          },
        });
      });
    });

    describe('CANCEL_CONVERSATION_PENDING_VERIFICATION', () => {
      function getAction(
        timestamp: number,
        conversationsState: ConversationsStateType
      ): CancelVerificationDataByConversationActionType {
        const dispatch = sinon.spy();

        cancelConversationVerification(timestamp)(
          dispatch,
          () => ({
            ...getEmptyRootState(),
            conversations: conversationsState,
          }),
          null
        );

        return dispatch.getCall(0).args[0];
      }

      it('replaces existing PendingVerification state', () => {
        const now = Date.now();
        const state: ConversationsStateType = {
          ...getEmptyState(),
          verificationDataByConversation: {
            'convo A': {
              type: ConversationVerificationState.PendingVerification,
              conversationsNeedingVerification: ['convo 1', 'convo 2'],
            },
          },
        };
        const action = getAction(now, state);
        const actual = reducer(state, action);

        assert.deepStrictEqual(actual.verificationDataByConversation, {
          'convo A': {
            type: ConversationVerificationState.VerificationCancelled,
            canceledAt: now,
          },
        });
      });

      it('updates timestamp for existing VerificationCancelled state', () => {
        const now = Date.now();
        const state: ConversationsStateType = {
          ...getEmptyState(),
          verificationDataByConversation: {
            'convo A': {
              type: ConversationVerificationState.VerificationCancelled,
              canceledAt: now - 1,
            },
          },
        };
        const action = getAction(now, state);
        const actual = reducer(state, action);

        assert.deepStrictEqual(actual.verificationDataByConversation, {
          'convo A': {
            type: ConversationVerificationState.VerificationCancelled,
            canceledAt: now,
          },
        });
      });

      it('uses newest timestamp when updating existing VerificationCancelled state', () => {
        const now = Date.now();
        const state: ConversationsStateType = {
          ...getEmptyState(),
          verificationDataByConversation: {
            'convo A': {
              type: ConversationVerificationState.VerificationCancelled,
              canceledAt: now,
            },
          },
        };
        const action = getAction(now, state);
        const actual = reducer(state, action);

        assert.deepStrictEqual(actual.verificationDataByConversation, {
          'convo A': {
            type: ConversationVerificationState.VerificationCancelled,
            canceledAt: now,
          },
        });
      });

      it('does nothing if no existing state', () => {
        const state: ConversationsStateType = getEmptyState();
        const action = getAction(Date.now(), state);
        const actual = reducer(state, action);

        assert.strictEqual(actual, state);
      });
    });

    describe('CANCEL_CONVERSATION_PENDING_VERIFICATION', () => {
      it('removes existing VerificationCancelled state', () => {
        const now = Date.now();
        const state: ConversationsStateType = {
          ...getEmptyState(),
          verificationDataByConversation: {
            'convo A': {
              type: ConversationVerificationState.VerificationCancelled,
              canceledAt: now,
            },
          },
        };
        const actual = reducer(
          state,
          clearCancelledConversationVerification('convo A')
        );

        assert.deepStrictEqual(actual.verificationDataByConversation, {});
      });

      it('leaves existing PendingVerification state', () => {
        const state: ConversationsStateType = {
          ...getEmptyState(),
          verificationDataByConversation: {
            'convo A': {
              type: ConversationVerificationState.PendingVerification,
              conversationsNeedingVerification: ['convo 1', 'convo 2'],
            },
          },
        };
        const actual = reducer(
          state,
          clearCancelledConversationVerification('convo A')
        );

        assert.deepStrictEqual(actual, state);
      });

      it('does nothing with empty state', () => {
        const state: ConversationsStateType = getEmptyState();
        const actual = reducer(
          state,
          clearCancelledConversationVerification('convo A')
        );

        assert.deepStrictEqual(actual, state);
      });
    });

    describe('REPAIR_NEWEST_MESSAGE', () => {
      it('updates newest', () => {
        const action = repairNewestMessage(conversationId);
        const state: ConversationsStateType = {
          ...getEmptyState(),
          messagesLookup: {
            [messageId]: {
              ...getDefaultMessage(messageId),
              received_at: time,
              sent_at: time,
            },
          },
          messagesByConversation: {
            [conversationId]: {
              ...getDefaultConversationMessage(),
              messageIds: [messageIdThree, messageIdTwo, messageId],
              metrics: {
                totalUnseen: 0,
              },
            },
          },
        };

        const expected: ConversationsStateType = {
          ...getEmptyState(),
          messagesLookup: {
            [messageId]: {
              ...getDefaultMessage(messageId),
              received_at: time,
              sent_at: time,
            },
          },
          messagesByConversation: {
            [conversationId]: {
              ...getDefaultConversationMessage(),
              messageIds: [messageIdThree, messageIdTwo, messageId],
              metrics: {
                totalUnseen: 0,
                newest: {
                  id: messageId,
                  received_at: time,
                  sent_at: time,
                },
              },
            },
          },
        };

        const actual = reducer(state, action);
        assert.deepEqual(actual, expected);
      });

      it('clears newest', () => {
        const action = repairNewestMessage(conversationId);
        const state: ConversationsStateType = {
          ...getEmptyState(),
          messagesLookup: {
            [messageId]: {
              ...getDefaultMessage(messageId),
              received_at: time,
            },
          },
          messagesByConversation: {
            [conversationId]: {
              ...getDefaultConversationMessage(),
              messageIds: [],
              metrics: {
                totalUnseen: 0,
                newest: {
                  id: messageId,
                  received_at: time,
                },
              },
            },
          },
        };

        const expected: ConversationsStateType = {
          ...getEmptyState(),
          messagesLookup: {
            [messageId]: {
              ...getDefaultMessage(messageId),
              received_at: time,
            },
          },
          messagesByConversation: {
            [conversationId]: {
              ...getDefaultConversationMessage(),
              messageIds: [],
              metrics: {
                newest: undefined,
                totalUnseen: 0,
              },
            },
          },
        };

        const actual = reducer(state, action);
        assert.deepEqual(actual, expected);
      });

      it('returns state if conversation not present', () => {
        const action = repairNewestMessage(conversationId);
        const state: ConversationsStateType = getEmptyState();
        const actual = reducer(state, action);

        assert.equal(actual, state);
      });
    });

    describe('REPAIR_OLDEST_MESSAGE', () => {
      it('updates oldest', () => {
        const action = repairOldestMessage(conversationId);
        const state: ConversationsStateType = {
          ...getEmptyState(),
          messagesLookup: {
            [messageId]: {
              ...getDefaultMessage(messageId),
              received_at: time,
              sent_at: time,
            },
          },
          messagesByConversation: {
            [conversationId]: {
              ...getDefaultConversationMessage(),
              messageIds: [messageId, messageIdTwo, messageIdThree],
              metrics: {
                totalUnseen: 0,
              },
            },
          },
        };

        const expected: ConversationsStateType = {
          ...getEmptyState(),
          messagesLookup: {
            [messageId]: {
              ...getDefaultMessage(messageId),
              received_at: time,
              sent_at: time,
            },
          },
          messagesByConversation: {
            [conversationId]: {
              ...getDefaultConversationMessage(),
              messageIds: [messageId, messageIdTwo, messageIdThree],
              metrics: {
                totalUnseen: 0,
                oldest: {
                  id: messageId,
                  received_at: time,
                  sent_at: time,
                },
              },
            },
          },
        };

        const actual = reducer(state, action);
        assert.deepEqual(actual, expected);
      });

      it('clears oldest', () => {
        const action = repairOldestMessage(conversationId);
        const state: ConversationsStateType = {
          ...getEmptyState(),
          messagesLookup: {
            [messageId]: {
              ...getDefaultMessage(messageId),
              received_at: time,
            },
          },
          messagesByConversation: {
            [conversationId]: {
              ...getDefaultConversationMessage(),
              messageIds: [],
              metrics: {
                totalUnseen: 0,
                oldest: {
                  id: messageId,
                  received_at: time,
                },
              },
            },
          },
        };

        const expected: ConversationsStateType = {
          ...getEmptyState(),
          messagesLookup: {
            [messageId]: {
              ...getDefaultMessage(messageId),
              received_at: time,
            },
          },
          messagesByConversation: {
            [conversationId]: {
              ...getDefaultConversationMessage(),
              messageIds: [],
              metrics: {
                oldest: undefined,
                totalUnseen: 0,
              },
            },
          },
        };

        const actual = reducer(state, action);
        assert.deepEqual(actual, expected);
      });

      it('returns state if conversation not present', () => {
        const action = repairOldestMessage(conversationId);
        const state: ConversationsStateType = getEmptyState();
        const actual = reducer(state, action);

        assert.equal(actual, state);
      });
    });

    describe('REVIEW_GROUP_MEMBER_NAME_COLLISION', () => {
      it('starts reviewing a group member name collision', () => {
        const state = getEmptyState();
        const action = reviewGroupMemberNameCollision('abc123');
        const actual = reducer(state, action);

        assert.deepEqual(actual.contactSpoofingReview, {
          type: ContactSpoofingType.MultipleGroupMembersWithSameTitle as const,
          groupConversationId: 'abc123',
        });
      });
    });

    describe('REVIEW_MESSAGE_REQUEST_NAME_COLLISION', () => {
      it('starts reviewing a message request name collision', () => {
        const state = getEmptyState();
        const action = reviewMessageRequestNameCollision({
          safeConversationId: 'def',
        });
        const actual = reducer(state, action);

        assert.deepEqual(actual.contactSpoofingReview, {
          type: ContactSpoofingType.DirectConversationWithSameTitle as const,
          safeConversationId: 'def',
        });
      });
    });

    describe('SET_COMPOSE_GROUP_AVATAR', () => {
      it("can clear the composer's group avatar", () => {
        const state = {
          ...getEmptyState(),
          composer: {
            ...defaultSetGroupMetadataComposerState,
            groupAvatar: new Uint8Array(2),
          },
        };
        const action = setComposeGroupAvatar(undefined);
        const result = reducer(state, action);

        assert(
          result.composer?.step === ComposerStep.SetGroupMetadata &&
            result.composer.groupAvatar === undefined
        );
      });

      it("can set the composer's group avatar", () => {
        const avatar = new Uint8Array([1, 2, 3]);

        const state = {
          ...getEmptyState(),
          composer: defaultSetGroupMetadataComposerState,
        };
        const action = setComposeGroupAvatar(avatar);
        const result = reducer(state, action);

        assert(
          result.composer?.step === ComposerStep.SetGroupMetadata &&
            result.composer.groupAvatar === avatar
        );
      });
    });

    describe('SET_COMPOSE_GROUP_NAME', () => {
      it("can set the composer's group name", () => {
        const state = {
          ...getEmptyState(),
          composer: defaultSetGroupMetadataComposerState,
        };
        const action = setComposeGroupName('bing bong');
        const result = reducer(state, action);

        assert(
          result.composer?.step === ComposerStep.SetGroupMetadata &&
            result.composer.groupName === 'bing bong'
        );
      });
    });

    describe('SET_COMPOSE_SEARCH_TERM', () => {
      it('updates the contact search term', () => {
        const state = {
          ...getEmptyState(),
          composer: defaultStartDirectConversationComposerState,
        };

        const result = reducer(state, setComposeSearchTerm('foo bar'));

        assert.deepEqual(result.composer, {
          ...defaultStartDirectConversationComposerState,
          searchTerm: 'foo bar',
        });
      });
    });

    describe('SET_PRE_JOIN_CONVERSATION', () => {
      const startState = {
        ...getEmptyState(),
      };

      it('starts with empty value', () => {
        assert.isUndefined(startState.preJoinConversation);
      });

      it('sets value as provided', () => {
        const preJoinConversation = {
          title: 'Pre-join group!',
          memberCount: 4,
          approvalRequired: false,
        };
        const stateWithData = reducer(
          startState,
          setPreJoinConversation(preJoinConversation)
        );

        assert.deepEqual(
          stateWithData.preJoinConversation,
          preJoinConversation
        );

        const resetState = reducer(
          stateWithData,
          setPreJoinConversation(undefined)
        );

        assert.isUndefined(resetState.preJoinConversation);
      });
    });

    describe('SHOW_ARCHIVED_CONVERSATIONS', () => {
      it('is a no-op when already at the archive', () => {
        const state = {
          ...getEmptyState(),
          showArchived: true,
        };
        const action = showArchivedConversations();
        const result = reducer(state, action);

        assert.isTrue(result.showArchived);
        assert.isUndefined(result.composer);
      });

      it('switches from the inbox to the archive', () => {
        const state = getEmptyState();
        const action = showArchivedConversations();
        const result = reducer(state, action);

        assert.isTrue(result.showArchived);
        assert.isUndefined(result.composer);
      });

      it('switches from the composer to the archive', () => {
        const state = {
          ...getEmptyState(),
          composer: defaultStartDirectConversationComposerState,
        };
        const action = showArchivedConversations();
        const result = reducer(state, action);

        assert.isTrue(result.showArchived);
        assert.isUndefined(result.composer);
      });
    });

    describe('SHOW_INBOX', () => {
      it('is a no-op when already at the inbox', () => {
        const state = getEmptyState();
        const action = showInbox();
        const result = reducer(state, action);

        assert.isFalse(result.showArchived);
        assert.isUndefined(result.composer);
      });

      it('switches from the archive to the inbox', () => {
        const state = {
          ...getEmptyState(),
          showArchived: true,
        };
        const action = showInbox();
        const result = reducer(state, action);

        assert.isFalse(result.showArchived);
        assert.isUndefined(result.composer);
      });

      it('switches from the composer to the inbox', () => {
        const state = {
          ...getEmptyState(),
          composer: defaultStartDirectConversationComposerState,
        };
        const action = showInbox();
        const result = reducer(state, action);

        assert.isFalse(result.showArchived);
        assert.isUndefined(result.composer);
      });
    });

    describe('START_COMPOSING', () => {
      it('does nothing if on the first step of the composer', () => {
        const state = {
          ...getEmptyState(),
          composer: defaultStartDirectConversationComposerState,
        };
        const action = startComposing();
        const result = reducer(state, action);

        assert.isFalse(result.showArchived);
        assert.deepEqual(
          result.composer,
          defaultStartDirectConversationComposerState
        );
      });

      it('if on the second step of the composer, goes back to the first step, clearing the search term', () => {
        const state = {
          ...getEmptyState(),
          composer: {
            ...defaultChooseGroupMembersComposerState,
            searchTerm: 'to be cleared',
          },
        };
        const action = startComposing();
        const result = reducer(state, action);

        assert.isFalse(result.showArchived);
        assert.deepEqual(
          result.composer,
          defaultStartDirectConversationComposerState
        );
      });

      it('if on the third step of the composer, goes back to the first step, clearing everything', () => {
        const state = {
          ...getEmptyState(),
          composer: defaultSetGroupMetadataComposerState,
        };
        const action = startComposing();
        const result = reducer(state, action);

        assert.isFalse(result.showArchived);
        assert.deepEqual(
          result.composer,
          defaultStartDirectConversationComposerState
        );
      });

      it('switches from the inbox to the composer', () => {
        const state = getEmptyState();
        const action = startComposing();
        const result = reducer(state, action);

        assert.isFalse(result.showArchived);
        assert.deepEqual(
          result.composer,
          defaultStartDirectConversationComposerState
        );
      });

      it('switches from the archive to the inbox', () => {
        const state = {
          ...getEmptyState(),
          showArchived: true,
        };
        const action = startComposing();
        const result = reducer(state, action);

        assert.isFalse(result.showArchived);
        assert.deepEqual(
          result.composer,
          defaultStartDirectConversationComposerState
        );
      });
    });

    describe('SHOW_CHOOSE_GROUP_MEMBERS', () => {
      it('switches to the second step of the composer if on the first step', () => {
        const state = {
          ...getEmptyState(),
          composer: {
            ...defaultStartDirectConversationComposerState,
            searchTerm: 'to be cleared',
          },
        };
        const action = showChooseGroupMembers();
        const result = reducer(state, action);

        assert.isFalse(result.showArchived);
        assert.deepEqual(result.composer, {
          ...defaultChooseGroupMembersComposerState,
          userAvatarData: getDefaultAvatars(true),
        });
      });

      it('does nothing if already on the second step of the composer', () => {
        const state = {
          ...getEmptyState(),
          composer: defaultChooseGroupMembersComposerState,
        };
        const action = showChooseGroupMembers();
        const result = reducer(state, action);

        assert.strictEqual(result, state);
      });

      it('returns to the second step if on the third step of the composer', () => {
        const state = {
          ...getEmptyState(),
          composer: {
            ...defaultSetGroupMetadataComposerState,
            groupName: 'Foo Bar Group',
            groupAvatar: new Uint8Array([4, 2]),
          },
        };
        const action = showChooseGroupMembers();
        const result = reducer(state, action);

        assert.isFalse(result.showArchived);
        assert.deepEqual(result.composer, {
          ...defaultChooseGroupMembersComposerState,
          groupName: 'Foo Bar Group',
          groupAvatar: new Uint8Array([4, 2]),
        });
      });

      it('switches from the inbox to the second step of the composer', () => {
        const state = getEmptyState();
        const action = showChooseGroupMembers();
        const result = reducer(state, action);

        assert.isFalse(result.showArchived);
        assert.deepEqual(result.composer, {
          ...defaultChooseGroupMembersComposerState,
          userAvatarData: getDefaultAvatars(true),
        });
      });

      it('switches from the archive to the second step of the composer', () => {
        const state = {
          ...getEmptyState(),
          showArchived: true,
        };
        const action = showChooseGroupMembers();
        const result = reducer(state, action);

        assert.isFalse(result.showArchived);
        assert.deepEqual(result.composer, {
          ...defaultChooseGroupMembersComposerState,
          userAvatarData: getDefaultAvatars(true),
        });
      });
    });

    describe('START_SETTING_GROUP_METADATA', () => {
      it('moves from the second to the third step of the composer', () => {
        const state = {
          ...getEmptyState(),
          composer: {
            ...defaultChooseGroupMembersComposerState,
            selectedConversationIds: ['abc', 'def'],
          },
        };
        const action = startSettingGroupMetadata();
        const result = reducer(state, action);

        assert.deepEqual(result.composer, {
          ...defaultSetGroupMetadataComposerState,
          selectedConversationIds: ['abc', 'def'],
        });
      });

      it('maintains state when going from the second to third steps of the composer, if the second step already had some data (likely from a previous visit)', () => {
        const state = {
          ...getEmptyState(),
          composer: {
            ...defaultChooseGroupMembersComposerState,
            searchTerm: 'foo bar',
            selectedConversationIds: ['abc', 'def'],
            groupName: 'Foo Bar Group',
            groupAvatar: new Uint8Array([6, 9]),
          },
        };
        const action = startSettingGroupMetadata();
        const result = reducer(state, action);

        assert.deepEqual(result.composer, {
          ...defaultSetGroupMetadataComposerState,
          selectedConversationIds: ['abc', 'def'],
          groupName: 'Foo Bar Group',
          groupAvatar: new Uint8Array([6, 9]),
        });
      });

      it('does nothing if already on the third step of the composer', () => {
        const state = {
          ...getEmptyState(),
          composer: defaultSetGroupMetadataComposerState,
        };
        const action = startSettingGroupMetadata();
        const result = reducer(state, action);

        assert.strictEqual(result, state);
      });
    });

    describe('TOGGLE_CONVERSATION_IN_CHOOSE_MEMBERS', () => {
      function getAction(
        id: string,
        conversationsState: ConversationsStateType
      ): ToggleConversationInChooseMembersActionType {
        const dispatch = sinon.spy();

        toggleConversationInChooseMembers(id)(
          dispatch,
          () => ({
            ...getEmptyRootState(),
            conversations: conversationsState,
          }),
          null
        );

        return dispatch.getCall(0).args[0];
      }

      beforeEach(async () => {
        await updateRemoteConfig([
          { name: 'global.groupsv2.maxGroupSize', value: '22', enabled: true },
          {
            name: 'global.groupsv2.groupSizeHardLimit',
            value: '33',
            enabled: true,
          },
        ]);
      });

      it('adds conversation IDs to the list', () => {
        const zero = {
          ...getEmptyState(),
          composer: defaultChooseGroupMembersComposerState,
        };
        const one = reducer(zero, getAction('abc', zero));
        const two = reducer(one, getAction('def', one));

        assert.deepEqual(two.composer, {
          ...defaultChooseGroupMembersComposerState,
          selectedConversationIds: ['abc', 'def'],
        });
      });

      it('removes conversation IDs from the list', () => {
        const state = {
          ...getEmptyState(),
          composer: {
            ...defaultChooseGroupMembersComposerState,
            selectedConversationIds: ['abc', 'def'],
          },
        };
        const action = getAction('abc', state);
        const result = reducer(state, action);

        assert.deepEqual(result.composer, {
          ...defaultChooseGroupMembersComposerState,
          selectedConversationIds: ['def'],
        });
      });

      it('shows the recommended group size modal when first crossing the maximum recommended group size', () => {
        const oldSelectedConversationIds = times(21, () => uuid());
        const newUuid = uuid();

        const state = {
          ...getEmptyState(),
          composer: {
            ...defaultChooseGroupMembersComposerState,
            selectedConversationIds: oldSelectedConversationIds,
          },
        };
        const action = getAction(newUuid, state);
        const result = reducer(state, action);

        assert.deepEqual(result.composer, {
          ...defaultChooseGroupMembersComposerState,
          selectedConversationIds: [...oldSelectedConversationIds, newUuid],
          recommendedGroupSizeModalState: OneTimeModalState.Showing,
        });
      });

      it("doesn't show the recommended group size modal twice", () => {
        const oldSelectedConversationIds = times(21, () => uuid());
        const newUuid = uuid();

        const state = {
          ...getEmptyState(),
          composer: {
            ...defaultChooseGroupMembersComposerState,
            selectedConversationIds: oldSelectedConversationIds,
            recommendedGroupSizeModalState: OneTimeModalState.Shown,
          },
        };
        const action = getAction(newUuid, state);
        const result = reducer(state, action);

        assert.deepEqual(result.composer, {
          ...defaultChooseGroupMembersComposerState,
          selectedConversationIds: [...oldSelectedConversationIds, newUuid],
          recommendedGroupSizeModalState: OneTimeModalState.Shown,
        });
      });

      it('defaults the maximum recommended size to 151', async () => {
        for (const value of [null, 'xyz']) {
          // eslint-disable-next-line no-await-in-loop
          await updateRemoteConfig([
            {
              name: 'global.groupsv2.maxGroupSize',
              value,
              enabled: true,
            },
            {
              name: 'global.groupsv2.groupSizeHardLimit',
              value: '33',
              enabled: true,
            },
          ]);

          const state = {
            ...getEmptyState(),
            composer: defaultChooseGroupMembersComposerState,
          };
          const action = getAction(uuid(), state);

          assert.strictEqual(action.payload.maxRecommendedGroupSize, 151);
        }
      });

      it('shows the maximum group size modal when first reaching the maximum group size', () => {
        const oldSelectedConversationIds = times(31, () => uuid());
        const newUuid = uuid();

        const state = {
          ...getEmptyState(),
          composer: {
            ...defaultChooseGroupMembersComposerState,
            selectedConversationIds: oldSelectedConversationIds,
            recommendedGroupSizeModalState: OneTimeModalState.Shown,
            maximumGroupSizeModalState: OneTimeModalState.NeverShown,
          },
        };
        const action = getAction(newUuid, state);
        const result = reducer(state, action);

        assert.deepEqual(result.composer, {
          ...defaultChooseGroupMembersComposerState,
          selectedConversationIds: [...oldSelectedConversationIds, newUuid],
          recommendedGroupSizeModalState: OneTimeModalState.Shown,
          maximumGroupSizeModalState: OneTimeModalState.Showing,
        });
      });

      it("doesn't show the maximum group size modal twice", () => {
        const oldSelectedConversationIds = times(31, () => uuid());
        const newUuid = uuid();

        const state = {
          ...getEmptyState(),
          composer: {
            ...defaultChooseGroupMembersComposerState,
            selectedConversationIds: oldSelectedConversationIds,
            recommendedGroupSizeModalState: OneTimeModalState.Shown,
            maximumGroupSizeModalState: OneTimeModalState.Shown,
          },
        };
        const action = getAction(newUuid, state);
        const result = reducer(state, action);

        assert.deepEqual(result.composer, {
          ...defaultChooseGroupMembersComposerState,
          selectedConversationIds: [...oldSelectedConversationIds, newUuid],
          recommendedGroupSizeModalState: OneTimeModalState.Shown,
          maximumGroupSizeModalState: OneTimeModalState.Shown,
        });
      });

      it('cannot select more than the maximum number of conversations', () => {
        const state = {
          ...getEmptyState(),
          composer: {
            ...defaultChooseGroupMembersComposerState,
            selectedConversationIds: times(1000, () => uuid()),
          },
        };
        const action = getAction(uuid(), state);
        const result = reducer(state, action);

        assert.deepEqual(result, state);
      });

      it('defaults the maximum group size to 1001 if the recommended maximum is smaller', async () => {
        for (const value of [null, 'xyz']) {
          // eslint-disable-next-line no-await-in-loop
          await updateRemoteConfig([
            { name: 'global.groupsv2.maxGroupSize', value: '2', enabled: true },
            {
              name: 'global.groupsv2.groupSizeHardLimit',
              value,
              enabled: true,
            },
          ]);

          const state = {
            ...getEmptyState(),
            composer: defaultChooseGroupMembersComposerState,
          };
          const action = getAction(uuid(), state);

          assert.strictEqual(action.payload.maxGroupSize, 1001);
        }
      });

      it('defaults the maximum group size to (recommended maximum + 1) if the recommended maximum is more than 1001', async () => {
        await updateRemoteConfig([
          {
            name: 'global.groupsv2.maxGroupSize',
            value: '1234',
            enabled: true,
          },
          {
            name: 'global.groupsv2.groupSizeHardLimit',
            value: '2',
            enabled: true,
          },
        ]);

        const state = {
          ...getEmptyState(),
          composer: defaultChooseGroupMembersComposerState,
        };
        const action = getAction(uuid(), state);

        assert.strictEqual(action.payload.maxGroupSize, 1235);
      });
    });
  });

  describe('COLORS_CHANGED', () => {
    const abc = getDefaultConversationWithUuid({
      id: 'abc',
      conversationColor: 'wintergreen',
    });
    const def = getDefaultConversationWithUuid({
      id: 'def',
      conversationColor: 'infrared',
    });
    const ghi = getDefaultConversation({
      id: 'ghi',
      e164: 'ghi',
      conversationColor: 'ember',
    });
    const jkl = getDefaultConversation({
      id: 'jkl',
      groupId: 'jkl',
      conversationColor: 'plum',
    });
    const getState = () => ({
      ...getEmptyRootState(),
      conversations: {
        ...getEmptyState(),
        conversationLookup: {
          abc,
          def,
          ghi,
          jkl,
        },
        conversationsByUuid: {
          abc,
          def,
        },
        conversationsByE164: {
          ghi,
        },
        conversationsByGroupId: {
          jkl,
        },
      },
    });

    it('resetAllChatColors', async () => {
      const dispatch = sinon.spy();
      await resetAllChatColors()(dispatch, getState, null);

      const [action] = dispatch.getCall(0).args;
      const nextState = reducer(getState().conversations, action);

      sinon.assert.calledOnce(dispatch);
      assert.isUndefined(nextState.conversationLookup.abc.conversationColor);
      assert.isUndefined(nextState.conversationLookup.def.conversationColor);
      assert.isUndefined(nextState.conversationLookup.ghi.conversationColor);
      assert.isUndefined(nextState.conversationLookup.jkl.conversationColor);
      assert.isUndefined(
        nextState.conversationsByUuid[abc.uuid].conversationColor
      );
      assert.isUndefined(
        nextState.conversationsByUuid[def.uuid].conversationColor
      );
      assert.isUndefined(nextState.conversationsByE164.ghi.conversationColor);
      assert.isUndefined(
        nextState.conversationsByGroupId.jkl.conversationColor
      );
      window.storage.remove('defaultConversationColor');
    });
  });
});
