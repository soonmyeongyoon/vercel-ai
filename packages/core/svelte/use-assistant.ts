/* eslint-disable react-hooks/rules-of-hooks */
import { useSWR } from 'sswr';
import { Readable, Writable, derived, get, writable } from 'svelte/store';

// import { useState } from 'react';
import { readDataStream } from '../shared/read-data-stream';
import { Message } from '../shared/types';

export type AssistantStatus = 'in_progress' | 'awaiting_message';

export type UseAssistantHelpers = {
  /**
   * The current array of chat messages.
   */
  messages: Readable<Message[]>;

  /**
   * The current thread ID.
   */
  threadId: Readable<string | undefined>;

  /**
   * The current value of the input field.
   */
  input: Writable<string>;

  /**
   * Form submission handler that automatically resets the input field and appends a user message.
   */
  submitMessage: (
    event?: any,
    requestOptions?: {
      data?: Record<string, string>;
    },
  ) => Promise<void>;

  /**
   * The current status of the assistant. This can be used to show a loading indicator.
   */
  status: Readable<AssistantStatus>;

  /**
   * The error thrown during the assistant message processing, if any.
   */
  error: Readable<undefined | unknown>;
};

export type UseAssistantOptions = {
  /**
   * The API endpoint that accepts a `{ threadId: string | null; message: string; }` object and returns an `AssistantResponse` stream.
   * The threadId refers to an existing thread with messages (or is `null` to create a new thread).
   * The message is the next message that should be appended to the thread and sent to the assistant.
   */
  api: string;

  /**
   * An optional string that represents the ID of an existing thread.
   * If not provided, a new thread will be created.
   */
  threadId?: string | undefined;

  /**
   * An optional literal that sets the mode of credentials to be used on the request.
   * Defaults to "same-origin".
   */
  credentials?: RequestCredentials;

  /**
   * An optional object of headers to be passed to the API endpoint.
   */
  headers?: Record<string, string> | Headers;

  /**
   * An optional, additional body object to be passed to the API endpoint.
   */
  body?: object;
};

let uniqueId = 0;
const store: Record<string, Message[] | undefined> = {};

export function experimental_useAssistant({
  api,
  threadId: threadIdParam,
  credentials,
  headers,
  body,
}: UseAssistantOptions): UseAssistantHelpers {
  const messages = writable<Message[]>([]);
  const input = writable<string>('');
  const threadId = writable<string | undefined>(undefined);
  const status = writable<AssistantStatus>('awaiting_message');
  const error = writable<unknown | undefined>(undefined);

  const submitMessage = async (
    event?: any,
    requestOptions?: {
      data?: Record<string, string>;
    },
  ) => {
    event?.preventDefault?.();

    const inputValue = get(input);

    if (inputValue === '') {
      return;
    }

    status.set('in_progress');

    messages.update(messages => [
      ...messages,
      { id: '', role: 'user', content: inputValue },
    ]);

    input.set('');

    const result = await fetch(api, {
      method: 'POST',
      credentials,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({
        ...body,
        // always use user-provided threadId when available:
        threadId: threadIdParam ?? get(threadId) ?? null,
        message: inputValue,

        // optional request data:
        data: requestOptions?.data,
      }),
    });

    if (result.body == null) {
      throw new Error('The response body is empty.');
    }

    try {
      for await (const { type, value } of readDataStream(
        result.body.getReader(),
      )) {
        switch (type) {
          case 'assistant_message': {
            messages.update(messages => [
              ...messages,
              {
                id: value.id,
                role: value.role,
                content: value.content[0].text.value,
              },
            ]);

            break;
          }

          case 'data_message': {
            messages.update(messages => [
              ...messages,
              {
                id: value.id ?? '',
                role: 'data' as const,
                content: '',
                data: value.data,
              },
            ]);
            break;
          }

          case 'assistant_control_data': {
            threadId.set(value.threadId);

            messages.update(messages => {
              const lastMessage = messages[messages.length - 1];
              lastMessage.id = value.messageId;
              return [...messages.slice(0, messages.length - 1), lastMessage];
            });
            break;
          }

          case 'error': {
            error.set(value);
            break;
          }
        }
      }
    } catch (error) {
      // @ts-ignore
      error.set(error);
    }
    status.set('awaiting_message');
  };

  return {
    messages,
    threadId,
    input,
    submitMessage,
    status,
    error,
  };
}
