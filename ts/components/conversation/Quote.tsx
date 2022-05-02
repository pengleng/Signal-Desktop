// Copyright 2018-2022 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import type { ReactNode } from 'react';
import React, { useRef, useState, useEffect } from 'react';
import { noop } from 'lodash';
import classNames from 'classnames';

import * as MIME from '../../types/MIME';
import * as GoogleChrome from '../../util/GoogleChrome';

import { MessageBody } from './MessageBody';
import type { AttachmentType, ThumbnailType } from '../../types/Attachment';
import type { BodyRangesType, LocalizerType } from '../../types/Util';
import type {
  ConversationColorType,
  CustomColorType,
} from '../../types/Colors';
import { ContactName } from './ContactName';
import { getTextWithMentions } from '../../util/getTextWithMentions';
import { getClassNamesFor } from '../../util/getClassNamesFor';
import { getCustomColorStyle } from '../../util/getCustomColorStyle';

export type Props = {
  authorTitle: string;
  conversationColor: ConversationColorType;
  curveTopLeft?: boolean;
  curveTopRight?: boolean;
  customColor?: CustomColorType;
  bodyRanges?: BodyRangesType;
  i18n: LocalizerType;
  isFromMe: boolean;
  isIncoming?: boolean;
  moduleClassName?: string;
  onClick?: () => void;
  onClose?: () => void;
  text: string;
  rawAttachment?: QuotedAttachmentType;
  isViewOnce: boolean;
  referencedMessageNotFound: boolean;
  doubleCheckMissingQuoteReference?: () => unknown;
};

type State = {
  imageBroken: boolean;
};

export type QuotedAttachmentType = Pick<
  AttachmentType,
  'contentType' | 'fileName' | 'isVoiceMessage' | 'thumbnail' | 'textAttachment'
>;

function validateQuote(quote: Props): boolean {
  if (quote.text) {
    return true;
  }

  if (quote.rawAttachment) {
    return true;
  }

  return false;
}

// Long message attachments should not be shown.
function getAttachment(
  rawAttachment: undefined | QuotedAttachmentType
): undefined | QuotedAttachmentType {
  return rawAttachment && !MIME.isLongMessage(rawAttachment.contentType)
    ? rawAttachment
    : undefined;
}

function getUrl(thumbnail?: ThumbnailType): string | undefined {
  if (!thumbnail) {
    return;
  }

  return thumbnail.objectUrl || thumbnail.url;
}

function getTypeLabel({
  i18n,
  isViewOnce = false,
  contentType,
  isVoiceMessage,
}: {
  i18n: LocalizerType;
  isViewOnce?: boolean;
  contentType: MIME.MIMEType;
  isVoiceMessage?: boolean;
}): string | undefined {
  if (GoogleChrome.isVideoTypeSupported(contentType)) {
    if (isViewOnce) {
      return i18n('message--getDescription--disappearing-video');
    }
    return i18n('video');
  }
  if (GoogleChrome.isImageTypeSupported(contentType)) {
    if (isViewOnce) {
      return i18n('message--getDescription--disappearing-photo');
    }
    return i18n('photo');
  }

  if (isViewOnce) {
    return i18n('message--getDescription--disappearing-media');
  }

  if (MIME.isAudio(contentType) && isVoiceMessage) {
    return i18n('voiceMessage');
  }

  return MIME.isAudio(contentType) ? i18n('audio') : undefined;
}

export class Quote extends React.Component<Props, State> {
  private getClassName: (modifier?: string) => string;

  constructor(props: Props) {
    super(props);
    this.state = {
      imageBroken: false,
    };
    this.getClassName = getClassNamesFor('module-quote', props.moduleClassName);
  }

  override componentDidMount(): void {
    const { doubleCheckMissingQuoteReference, referencedMessageNotFound } =
      this.props;

    if (referencedMessageNotFound) {
      doubleCheckMissingQuoteReference?.();
    }
  }

  public handleKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>
  ): void => {
    const { onClick } = this.props;

    // This is important to ensure that using this quote to navigate to the referenced
    //   message doesn't also trigger its parent message's keydown.
    if (onClick && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      event.stopPropagation();
      onClick();
    }
  };

  public handleClick = (event: React.MouseEvent<HTMLButtonElement>): void => {
    const { onClick } = this.props;

    if (onClick) {
      event.preventDefault();
      event.stopPropagation();
      onClick();
    }
  };

  public handleImageError = (): void => {
    window.console.info(
      'Message: Image failed to load; failing over to placeholder'
    );
    this.setState({
      imageBroken: true,
    });
  };

  public renderImage(url: string, icon?: string): JSX.Element {
    const iconElement = icon ? (
      <div className={this.getClassName('__icon-container__inner')}>
        <div
          className={this.getClassName('__icon-container__circle-background')}
        >
          <div
            className={classNames(
              this.getClassName('__icon-container__icon'),
              this.getClassName(`__icon-container__icon--${icon}`)
            )}
          />
        </div>
      </div>
    ) : null;

    return (
      <ThumbnailImage
        className={this.getClassName('__icon-container')}
        src={url}
        onError={this.handleImageError}
      >
        {iconElement}
      </ThumbnailImage>
    );
  }

  public renderIcon(icon: string): JSX.Element {
    return (
      <div className={this.getClassName('__icon-container')}>
        <div className={this.getClassName('__icon-container__inner')}>
          <div
            className={this.getClassName('__icon-container__circle-background')}
          >
            <div
              className={classNames(
                this.getClassName('__icon-container__icon'),
                this.getClassName(`__icon-container__icon--${icon}`)
              )}
            />
          </div>
        </div>
      </div>
    );
  }

  public renderGenericFile(): JSX.Element | null {
    const { rawAttachment, isIncoming } = this.props;
    const attachment = getAttachment(rawAttachment);

    if (!attachment) {
      return null;
    }

    const { fileName, contentType, textAttachment } = attachment;
    const isGenericFile =
      !GoogleChrome.isVideoTypeSupported(contentType) &&
      !GoogleChrome.isImageTypeSupported(contentType) &&
      !textAttachment &&
      !MIME.isAudio(contentType);

    if (!isGenericFile) {
      return null;
    }

    return (
      <div className={this.getClassName('__generic-file')}>
        <div className={this.getClassName('__generic-file__icon')} />
        <div
          className={classNames(
            this.getClassName('__generic-file__text'),
            isIncoming
              ? this.getClassName('__generic-file__text--incoming')
              : null
          )}
        >
          {fileName}
        </div>
      </div>
    );
  }

  public renderIconContainer(): JSX.Element | null {
    const { rawAttachment, isViewOnce } = this.props;
    const { imageBroken } = this.state;
    const attachment = getAttachment(rawAttachment);

    if (!attachment) {
      return null;
    }

    const { contentType, textAttachment, thumbnail } = attachment;
    const url = getUrl(thumbnail);

    if (isViewOnce) {
      return this.renderIcon('view-once');
    }

    // TODO DESKTOP-3433
    if (textAttachment) {
      return this.renderIcon('image');
    }

    if (GoogleChrome.isVideoTypeSupported(contentType)) {
      return url && !imageBroken
        ? this.renderImage(url, 'play')
        : this.renderIcon('movie');
    }
    if (GoogleChrome.isImageTypeSupported(contentType)) {
      return url && !imageBroken
        ? this.renderImage(url)
        : this.renderIcon('image');
    }
    if (MIME.isAudio(contentType)) {
      return this.renderIcon('microphone');
    }

    return null;
  }

  public renderText(): JSX.Element | null {
    const { bodyRanges, i18n, text, rawAttachment, isIncoming, isViewOnce } =
      this.props;

    if (text) {
      const quoteText = bodyRanges
        ? getTextWithMentions(bodyRanges, text)
        : text;

      return (
        <div
          dir="auto"
          className={classNames(
            this.getClassName('__primary__text'),
            isIncoming ? this.getClassName('__primary__text--incoming') : null
          )}
        >
          <MessageBody
            disableLinks
            disableJumbomoji
            text={quoteText}
            i18n={i18n}
          />
        </div>
      );
    }

    const attachment = getAttachment(rawAttachment);

    if (!attachment) {
      return null;
    }

    const { contentType, isVoiceMessage } = attachment;

    const typeLabel = getTypeLabel({
      i18n,
      isViewOnce,
      contentType,
      isVoiceMessage,
    });
    if (typeLabel) {
      return (
        <div
          className={classNames(
            this.getClassName('__primary__type-label'),
            isIncoming
              ? this.getClassName('__primary__type-label--incoming')
              : null
          )}
        >
          {typeLabel}
        </div>
      );
    }

    return null;
  }

  public renderClose(): JSX.Element | null {
    const { i18n, onClose } = this.props;

    if (!onClose) {
      return null;
    }

    const clickHandler = (e: React.MouseEvent): void => {
      e.stopPropagation();
      e.preventDefault();

      onClose();
    };
    const keyDownHandler = (e: React.KeyboardEvent): void => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.stopPropagation();
        e.preventDefault();

        onClose();
      }
    };

    // We need the container to give us the flexibility to implement the iOS design.
    return (
      <div className={this.getClassName('__close-container')}>
        <div
          tabIndex={0}
          // We can't be a button because the overall quote is a button; can't nest them
          role="button"
          className={this.getClassName('__close-button')}
          aria-label={i18n('close')}
          onKeyDown={keyDownHandler}
          onClick={clickHandler}
        />
      </div>
    );
  }

  public renderAuthor(): JSX.Element {
    const { authorTitle, i18n, isFromMe, isIncoming } = this.props;

    return (
      <div
        className={classNames(
          this.getClassName('__primary__author'),
          isIncoming ? this.getClassName('__primary__author--incoming') : null
        )}
      >
        {isFromMe ? i18n('you') : <ContactName title={authorTitle} />}
      </div>
    );
  }

  public renderReferenceWarning(): JSX.Element | null {
    const {
      conversationColor,
      customColor,
      i18n,
      isIncoming,
      referencedMessageNotFound,
    } = this.props;

    if (!referencedMessageNotFound) {
      return null;
    }

    return (
      <div
        className={classNames(
          this.getClassName('__reference-warning'),
          isIncoming
            ? this.getClassName(`--incoming-${conversationColor}`)
            : this.getClassName(`--outgoing-${conversationColor}`)
        )}
        style={{ ...getCustomColorStyle(customColor, true) }}
      >
        <div
          className={classNames(
            this.getClassName('__reference-warning__icon'),
            isIncoming
              ? this.getClassName('__reference-warning__icon--incoming')
              : null
          )}
        />
        <div
          className={classNames(
            this.getClassName('__reference-warning__text'),
            isIncoming
              ? this.getClassName('__reference-warning__text--incoming')
              : null
          )}
        >
          {i18n('originalMessageNotFound')}
        </div>
      </div>
    );
  }

  public override render(): JSX.Element | null {
    const {
      conversationColor,
      curveTopLeft,
      curveTopRight,
      customColor,
      isIncoming,
      onClick,
      referencedMessageNotFound,
    } = this.props;

    if (!validateQuote(this.props)) {
      return null;
    }

    return (
      <div className={this.getClassName('__container')}>
        <button
          type="button"
          onClick={this.handleClick}
          onKeyDown={this.handleKeyDown}
          className={classNames(
            this.getClassName(''),
            isIncoming
              ? this.getClassName('--incoming')
              : this.getClassName('--outgoing'),
            isIncoming
              ? this.getClassName(`--incoming-${conversationColor}`)
              : this.getClassName(`--outgoing-${conversationColor}`),
            !onClick && this.getClassName('--no-click'),
            referencedMessageNotFound &&
              this.getClassName('--with-reference-warning'),
            curveTopLeft && this.getClassName('--curve-top-left'),
            curveTopRight && this.getClassName('--curve-top-right')
          )}
          style={{ ...getCustomColorStyle(customColor, true) }}
        >
          <div className={this.getClassName('__primary')}>
            {this.renderAuthor()}
            {this.renderGenericFile()}
            {this.renderText()}
          </div>
          {this.renderIconContainer()}
          {this.renderClose()}
        </button>
        {this.renderReferenceWarning()}
      </div>
    );
  }
}

function ThumbnailImage({
  className,
  src,
  onError,
  children,
}: Readonly<{
  className: string;
  src: string;
  onError: () => void;
  children: ReactNode;
}>): JSX.Element {
  const imageRef = useRef(new Image());
  const [loadedSrc, setLoadedSrc] = useState<null | string>(null);

  useEffect(() => {
    const image = new Image();
    image.onload = () => {
      setLoadedSrc(src);
    };
    image.src = src;
    imageRef.current = image;
    return () => {
      image.onload = noop;
    };
  }, [src]);

  useEffect(() => {
    setLoadedSrc(null);
  }, [src]);

  useEffect(() => {
    const image = imageRef.current;
    image.onerror = onError;
    return () => {
      image.onerror = noop;
    };
  }, [onError]);

  return (
    <div
      className={className}
      style={
        loadedSrc ? { backgroundImage: `url('${encodeURI(loadedSrc)}')` } : {}
      }
    >
      {children}
    </div>
  );
}
