"use client";

import { FormEvent, useMemo, useState } from "react";
import { useChat } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import type { Product } from "@/types/product";
import { shouldRenderAssistantText } from "@/lib/messageText";
import { ProductGrid } from "./ProductGrid";

const suggestedPrompts = [
  "A luxury summer outfit for a beach wedding in Goa under ₹25,000",
  "Smart casual look for a men's office party",
  "Elegant black dress for a dinner date",
];

type SearchProductsOutput = {
  products?: Product[];
  count?: number;
};

function MessageContent({ message }: { message: UIMessage }) {
  const isAssistant = message.role === "assistant";

  return (
    <div className="space-y-4">
      {message.parts.map((part, index) => {
        if (part.type === "text") {
          const hasRenderedToolOutput = message.parts
            .slice(0, index)
            .some(
              (previousPart) =>
                previousPart.type === "tool-search_products" &&
                (previousPart as { state?: string }).state === "output-available",
            );

          if (!shouldRenderAssistantText(part.text, hasRenderedToolOutput)) {
            return null;
          }

          return (
            <p key={`${message.id}-text-${index}`} className="whitespace-pre-wrap leading-7">
              {part.text}
            </p>
          );
        }

        if (part.type === "tool-search_products") {
          const toolPart = part as {
            state?: string;
            output?: unknown;
            errorText?: string;
          };

          if (toolPart.state === "output-available") {
            const output = toolPart.output as SearchProductsOutput;
            const products = output.products ?? [];

            return (
              <div key={`${message.id}-products-${index}`} className="min-w-0 space-y-3">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.24em] text-[#C9A84C]">
                  <span className="h-px flex-1 bg-[#C9A84C]/30" />
                  Curated Finds
                  <span className="h-px flex-1 bg-[#C9A84C]/30" />
                </div>
                <ProductGrid products={products} compact />
              </div>
            );
          }

          if (toolPart.state === "output-error") {
            return (
              <p key={`${message.id}-tool-error-${index}`} className="text-sm text-red-200">
                {toolPart.errorText || "The product search failed. Please try again."}
              </p>
            );
          }

          return (
            <div
              key={`${message.id}-tool-loading-${index}`}
              className="rounded-2xl border border-[#C9A84C]/20 bg-[#C9A84C]/10 px-4 py-3 text-sm text-[#F3D884]"
            >
              Searching the collection...
            </div>
          );
        }

        return null;
      })}

      {isAssistant && !message.parts.length ? (
        <p className="text-white/50">Thinking through the best pieces...</p>
      ) : null}
    </div>
  );
}

export function ChatInterface() {
  const { messages, sendMessage, status, error, stop } = useChat();
  const [input, setInput] = useState("");
  const isBusy = status === "submitted" || status === "streaming";

  const hasMessages = messages.length > 0;
  const renderedMessages = useMemo(
    () => messages.filter((message) => message.role !== "system"),
    [messages],
  );

  async function submitPrompt(prompt: string) {
    const text = prompt.trim();
    if (!text || isBusy) return;

    setInput("");
    await sendMessage({ text });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitPrompt(input);
  }

  return (
    <section className="flex min-h-[75vh] flex-col overflow-hidden rounded-[2rem] border border-white/10 bg-[#070A12]/80 shadow-2xl shadow-black/30 backdrop-blur-xl lg:min-h-[calc(100vh-16rem)]">
      <div className="border-b border-white/10 px-5 py-4 sm:px-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#C9A84C]">
              LuxeAgent Chat
            </p>
            <h2 className="mt-1 text-xl font-semibold text-white">Your private fashion concierge</h2>
          </div>
          {isBusy ? (
            <button
              type="button"
              onClick={stop}
              className="rounded-full border border-white/15 px-4 py-2 text-sm text-white/75 transition hover:border-[#C9A84C]/50 hover:text-white"
            >
              Stop
            </button>
          ) : null}
        </div>
      </div>

      <div className="flex-1 space-y-6 overflow-y-auto px-4 py-6 sm:px-6">
        {!hasMessages ? (
          <div className="flex h-full min-h-[420px] flex-col items-center justify-center text-center">
            <div className="max-w-2xl space-y-4">
              <p className="text-sm font-semibold uppercase tracking-[0.3em] text-[#C9A84C]">
                Begin With A Brief
              </p>
              <h3 className="font-serif text-3xl text-white sm:text-5xl">
                Tell me the occasion. I&apos;ll find the look.
              </h3>
              <p className="text-white/58">
                Ask for complete outfits, category-specific pieces, colour preferences, or budget-aware
                recommendations.
              </p>
            </div>

            <div className="mt-8 grid w-full max-w-3xl gap-3">
              {suggestedPrompts.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => submitPrompt(prompt)}
                  className="rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-4 text-left text-sm text-white/82 transition hover:border-[#C9A84C]/50 hover:bg-[#C9A84C]/10 hover:text-white"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          renderedMessages.map((message) => {
            const isUser = message.role === "user";

            return (
              <div
                key={message.id}
                className={`flex ${isUser ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`min-w-0 rounded-[1.5rem] px-5 py-4 text-sm ${
                    isUser
                      ? "max-w-[92%] bg-[#C9A84C] text-[#070A12] sm:max-w-[78%]"
                      : "w-full max-w-full border border-white/10 bg-white/[0.05] text-white/85 sm:max-w-[88%]"
                  }`}
                >
                  <MessageContent message={message} />
                </div>
              </div>
            );
          })
        )}

        {error ? (
          <div className="rounded-2xl border border-red-300/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            {error.message}
          </div>
        ) : null}
      </div>

      <form onSubmit={handleSubmit} className="border-t border-white/10 p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Describe the look, occasion, budget, or mood..."
            className="h-14 flex-1 rounded-full border border-white/10 bg-white/[0.06] px-5 text-white outline-none transition placeholder:text-white/35 focus:border-[#C9A84C]/70 focus:ring-4 focus:ring-[#C9A84C]/10"
          />
          <button
            type="submit"
            disabled={isBusy || !input.trim()}
            className="h-14 rounded-full bg-[#C9A84C] px-8 text-sm font-bold uppercase tracking-[0.24em] text-[#070A12] transition hover:bg-[#E1C86C] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </form>
    </section>
  );
}
