import { formatStreamPart } from '../shared/stream-parts';
import {
  AssistantMessage,
  DataMessage,
  ToolCallMessage,
} from '../shared/types';

type AssistantResponseSettings = {
  threadId: string;
  messageId: string;
};

export type AssistantResponseCallback = (stream: {
  threadId: string;
  messageId: string;
  sendMessage: (message: AssistantMessage) => void;
  sendDataMessage: (message: DataMessage) => void;
  sendToolCallMessage: (message: ToolCallMessage) => void;
}) => Promise<void>;

export function experimental_AssistantResponse(
  { threadId, messageId }: AssistantResponseSettings,
  process: AssistantResponseCallback,
): Response {
  const stream = new ReadableStream({
    async start(controller) {
      const textEncoder = new TextEncoder();

      const sendMessage = (message: AssistantMessage) => {
        controller.enqueue(
          textEncoder.encode(formatStreamPart('assistant_message', message)),
        );
      };

      const sendDataMessage = (message: DataMessage) => {
        controller.enqueue(
          textEncoder.encode(formatStreamPart('data_message', message)),
        );
      };

      const sendError = (errorMessage: string) => {
        controller.enqueue(
          textEncoder.encode(formatStreamPart('error', errorMessage)),
        );
      };
      // CUSTOM IMPLEMENTATION TO SUPPORT TOOL CALL FORWARDING TO FRONTEND
      const sendToolCallMessage = (message: ToolCallMessage) => {
        controller.enqueue(
          textEncoder.encode(formatStreamPart('tool_calls', message)),
        );
      };

      // send the threadId and messageId as the first message:
      controller.enqueue(
        textEncoder.encode(
          formatStreamPart('assistant_control_data', {
            threadId,
            messageId,
          }),
        ),
      );

      try {
        await process({
          threadId,
          messageId,
          sendMessage,
          sendDataMessage,
          sendToolCallMessage,
        });
      } catch (error) {
        sendError((error as any).message ?? `${error}`);
      } finally {
        controller.close();
      }
    },
    pull(controller) {},
    cancel() {},
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
}
