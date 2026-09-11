// CopilotKit runtime — powers the tutor chat sidebar ("explain more", "give me
// a hint"). It reuses the same provider config as the lesson agent via a
// LangChain adapter, including its fallback chain. In mock mode (no API key)
// there is no chat model, so we fall back to an empty adapter and the UI tells
// the user chat needs a key.

import { NextRequest } from "next/server";
import {
  CopilotRuntime,
  EmptyAdapter,
  LangChainAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
  type CopilotServiceAdapter,
} from "@copilotkit/runtime";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { IterableReadableStream } from "@langchain/core/utils/stream";
import { createChatModels } from "@/agent/llm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function withTools(model: BaseChatModel, tools: unknown[] | undefined) {
  const bindable = model as unknown as {
    bindTools?: (t: unknown[]) => BaseChatModel;
  };
  return tools && tools.length > 0 && typeof bindable.bindTools === "function"
    ? bindable.bindTools(tools)
    : model;
}

export async function POST(req: NextRequest) {
  const models = await createChatModels();

  let serviceAdapter: CopilotServiceAdapter;
  if (models.length) {
    serviceAdapter = new LangChainAdapter({
      chainFn: async ({ messages, tools }) => {
        let lastError: unknown;
        for (const model of models) {
          try {
            const iterator = (
              await withTools(model, tools).stream(messages)
            )[Symbol.asyncIterator]();
            // Pull the first chunk here: a stream only issues its HTTP request
            // when it is read, so rate limits and bad models surface on this
            // line rather than mid-reply, which is what lets us fall through
            // to the next provider instead of erroring in the sidebar.
            const first = await iterator.next();
            return IterableReadableStream.fromAsyncGenerator(
              (async function* () {
                for (let res = first; !res.done; res = await iterator.next()) {
                  yield res.value;
                }
              })(),
            );
          } catch (err) {
            lastError = err;
            console.error(
              "[copilotkit] chat model failed, trying next in chain:",
              err instanceof Error ? err.message : err,
            );
          }
        }
        throw lastError ?? new Error("No chat model available");
      },
    });
  } else {
    serviceAdapter = new EmptyAdapter();
  }

  const copilotRuntime = new CopilotRuntime();

  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime: copilotRuntime,
    serviceAdapter,
    endpoint: "/api/copilotkit",
  });

  return handleRequest(req);
}
