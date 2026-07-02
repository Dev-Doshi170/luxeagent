"use client";

import { FormEvent, useMemo, useState, useRef, useEffect } from "react";
import { useChat } from "@ai-sdk/react";
import type { UIMessage, FileUIPart } from "ai";
import type { Product } from "@/types/product";
import { shouldRenderAssistantText } from "@/lib/messageText";
import { ProductCard } from "./ProductCard";

const suggestedPrompts = [
  "Find a luxury summer outfit for a beach wedding in Goa under ₹25,000",
  "Show me some smart casual shirts for a men's office party",
  "Elegant black dresses for a dinner date night",
];

type SearchProductsOutput = {
  products?: Product[];
  count?: number;
};

type CheckInventoryOutput = {
  productId: number;
  name: string;
  brand: string;
  sizes: { S: number; M: number; L: number; XL: number };
};

interface CartItem {
  id: number;
  name: string;
  brand: string | null;
  image_url: string;
  size: string;
  quantity: number;
}

interface SizePickerProps {
  productId: number;
  name: string;
  brand: string | null;
  sizes: { S: number; M: number; L: number; XL: number };
  onAddToBag: (product: { id: number; name: string; brand: string | null; image_url: string }, size: string) => void;
}

function SizePicker({ productId, name, brand, sizes, onAddToBag }: SizePickerProps) {
  const [selectedSize, setSelectedSize] = useState<string | null>(null);

  const availableSizes = [
    { label: "S", stock: sizes.S },
    { label: "M", stock: sizes.M },
    { label: "L", stock: sizes.L },
    { label: "XL", stock: sizes.XL },
  ];

  return (
    <div className="max-w-md rounded-2xl border border-[#C9A84C]/30 bg-[#C9A84C]/5 p-5 space-y-4">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.24em] text-[#C9A84C]">
        <span className="h-px w-6 bg-[#C9A84C]/30" />
        Live Stock Selection
        <span className="h-px flex-1 bg-[#C9A84C]/30" />
      </div>
      <div>
        <p className="text-xs uppercase tracking-wider text-white/50">{brand || "Luxe Curated"}</p>
        <h4 className="font-serif text-lg text-white mt-0.5">{name}</h4>
      </div>

      <div className="grid grid-cols-4 gap-2">
        {availableSizes.map(({ label, stock }) => {
          const isSelected = selectedSize === label;
          const isOutOfStock = stock <= 0;

          return (
            <button
              key={label}
              type="button"
              disabled={isOutOfStock}
              onClick={() => setSelectedSize(label)}
              className={`h-12 rounded-xl flex flex-col items-center justify-center text-xs font-bold transition duration-200 cursor-pointer ${
                isOutOfStock
                  ? "border border-white/5 bg-white/[0.02] text-white/20 line-through cursor-not-allowed"
                  : isSelected
                  ? "bg-[#C9A84C] text-[#070A12]"
                  : "border border-white/10 bg-white/[0.04] text-white hover:border-[#C9A84C]/50 hover:bg-[#C9A84C]/10"
              }`}
            >
              <span>{label}</span>
              {!isOutOfStock && <span className="text-[9px] mt-0.5 opacity-80">{stock} left</span>}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        disabled={!selectedSize}
        onClick={() => {
          if (selectedSize) {
            onAddToBag({ id: productId, name, brand, image_url: "" }, selectedSize);
          }
        }}
        className="w-full h-11 rounded-xl bg-[#C9A84C] hover:bg-[#E1C86C] text-[#070A12] font-bold text-xs uppercase tracking-widest transition duration-200 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
      >
        {selectedSize ? `Add Size ${selectedSize} To Bag` : "Select A Size First"}
      </button>
    </div>
  );
}

interface ProductCarouselProps {
  products: Product[];
  onCheckSizes: (productId: number, name: string) => void;
}

function ProductCarousel({ products, onCheckSizes }: ProductCarouselProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const scroll = (direction: "left" | "right") => {
    if (containerRef.current) {
      const scrollAmount = 280;
      containerRef.current.scrollBy({
        left: direction === "left" ? -scrollAmount : scrollAmount,
        behavior: "smooth",
      });
    }
  };

  if (!products.length) return null;

  return (
    <div className="relative group/carousel min-w-0">
      {/* Navigation Arrows */}
      <button
        onClick={() => scroll("left")}
        className="absolute left-2 top-1/2 -translate-y-1/2 z-10 w-9 h-9 rounded-full bg-[#070A12]/80 border border-white/10 flex items-center justify-center text-white opacity-0 group-hover/carousel:opacity-100 transition duration-200 hover:bg-[#C9A84C] hover:text-[#070A12] cursor-pointer"
        type="button"
        aria-label="Scroll left"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 256 256">
          <path d="M165.66,202.34a8,8,0,0,1-11.32,11.32l-80-80a8,8,0,0,1,0-11.32l80-80a8,8,0,0,1,11.32,11.32L91.31,128Z" />
        </svg>
      </button>

      <button
        onClick={() => scroll("right")}
        className="absolute right-2 top-1/2 -translate-y-1/2 z-10 w-9 h-9 rounded-full bg-[#070A12]/80 border border-white/10 flex items-center justify-center text-white opacity-0 group-hover/carousel:opacity-100 transition duration-200 hover:bg-[#C9A84C] hover:text-[#070A12] cursor-pointer"
        type="button"
        aria-label="Scroll right"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 256 256">
          <path d="M96,40a8,8,0,0,1,11.31,0l80,80a8,8,0,0,1,0,11.32l-80,80a8,8,0,0,1-11.31-11.32L164.69,128,96,59.31A8,8,0,0,1,96,40Z" />
        </svg>
      </button>

      {/* Carousel Container */}
      <div
        ref={containerRef}
        className="flex gap-4 overflow-x-auto pb-4 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent scroll-smooth snap-x"
      >
        {products.map((product) => (
          <div key={product.id} className="w-[200px] flex-shrink-0 snap-start space-y-3">
            <ProductCard product={product} />
            <button
              onClick={() => onCheckSizes(product.id, product.name)}
              className="w-full py-2.5 rounded-xl border border-[#C9A84C]/30 bg-[#C9A84C]/5 text-[#C9A84C] text-[11px] font-bold uppercase tracking-widest hover:bg-[#C9A84C] hover:text-[#070A12] transition duration-200 cursor-pointer"
              type="button"
            >
              Verify Stock & Size
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function MessageContent({ message, onCheckSizes, onAddToBag }: { message: UIMessage; onCheckSizes: (productId: number, name: string) => void; onAddToBag: (product: { id: number; name: string; brand: string | null; image_url: string }, size: string) => void }) {
  const isAssistant = message.role === "assistant";

  return (
    <div className="space-y-4">
      {message.parts.map((part, index) => {
        if (part.type === "text") {
          const hasRenderedToolOutput = message.parts
            .slice(0, index)
            .some(
              (previousPart) =>
                (previousPart.type === "tool-search_products" || previousPart.type === "tool-search_products_by_image" || previousPart.type === "tool-check_inventory") &&
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

        if (part.type === "file") {
          const filePart = part as FileUIPart;
          if (filePart.mediaType?.startsWith("image/")) {
            return (
              <div key={`${message.id}-file-${index}`} className="relative rounded-lg overflow-hidden border border-white/20 h-24 w-24 bg-[#070A12] mt-2 mb-1">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={filePart.url} alt="Upload" className="h-full w-full object-cover" />
              </div>
            );
          }
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
                  Curated Luxury Recommendations
                  <span className="h-px flex-1 bg-[#C9A84C]/30" />
                </div>
                <ProductCarousel products={products} onCheckSizes={onCheckSizes} />
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
              className="flex items-center gap-2.5 rounded-2xl border border-[#C9A84C]/20 bg-[#C9A84C]/10 px-4 py-3 text-sm text-[#F3D884]"
            >
              <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Curating our collection matching your request...
            </div>
          );
        }

        if (part.type === "tool-search_products_by_image") {
          const toolPart = part as {
            state?: string;
            output?: unknown;
            errorText?: string;
          };

          if (toolPart.state === "output-available") {
            const output = toolPart.output as SearchProductsOutput;
            const products = output.products ?? [];

            return (
              <div key={`${message.id}-products-visual-${index}`} className="min-w-0 space-y-3">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.24em] text-[#C9A84C]">
                  <span className="h-px flex-1 bg-[#C9A84C]/30" />
                  Curated Visual Recommendations
                  <span className="h-px flex-1 bg-[#C9A84C]/30" />
                </div>
                <ProductCarousel products={products} onCheckSizes={onCheckSizes} />
              </div>
            );
          }

          if (toolPart.state === "output-error") {
            return (
              <p key={`${message.id}-tool-error-visual-${index}`} className="text-sm text-red-200">
                {toolPart.errorText || "The visual product search failed. Please try again."}
              </p>
            );
          }

          return (
            <div
              key={`${message.id}-tool-loading-visual-${index}`}
              className="flex items-center gap-2.5 rounded-2xl border border-[#C9A84C]/20 bg-[#C9A84C]/10 px-4 py-3 text-sm text-[#F3D884]"
            >
              <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Curating visual matches matching your request...
            </div>
          );
        }

        if (part.type === "tool-check_inventory") {
          const toolPart = part as {
            state?: string;
            output?: unknown;
            errorText?: string;
          };

          if (toolPart.state === "output-available") {
            const output = toolPart.output as CheckInventoryOutput;
            return (
              <SizePicker
                key={`${message.id}-inventory-${index}`}
                productId={output.productId}
                name={output.name}
                brand={output.brand}
                sizes={output.sizes}
                onAddToBag={onAddToBag}
              />
            );
          }

          if (toolPart.state === "output-error") {
            return (
              <p key={`${message.id}-tool-error-${index}`} className="text-sm text-red-200">
                {toolPart.errorText || "Checking inventory failed. Please try again."}
              </p>
            );
          }

          return (
            <div
              key={`${message.id}-tool-loading-${index}`}
              className="flex items-center gap-2.5 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/50"
            >
              <svg className="animate-spin h-4 w-4 text-[#C9A84C]" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Connecting to boutique stock services...
            </div>
          );
        }

        return null;
      })}

      {isAssistant && !message.parts.length ? (
        <p className="text-white/50">Consulting with design houses...</p>
      ) : null}
    </div>
  );
}

export function ChatInterface() {
  const { messages, sendMessage, status, error, stop } = useChat();
  const [input, setInput] = useState("");
  const [uploadedFiles, setUploadedFiles] = useState<FileUIPart[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isBagOpen, setIsBagOpen] = useState(false);
  const [checkoutStatus, setCheckoutStatus] = useState<"idle" | "authenticating" | "shipping" | "confirmed">("idle");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isBusy = status === "submitted" || status === "streaming";
  const hasMessages = messages.length > 0;

  const renderedMessages = useMemo(
    () => messages.filter((message) => message.role !== "system"),
    [messages],
  );

  // Load shopping cart from localStorage on mount
  useEffect(() => {
    const savedCart = localStorage.getItem("luxeagent_cart");
    if (savedCart) {
      try {
        setCart(JSON.parse(savedCart) as CartItem[]);
      } catch (e) {
        console.error("Error loading cart", e);
      }
    }
  }, []);

  // Sync cart to localStorage
  const saveCart = (newCart: CartItem[]) => {
    setCart(newCart);
    localStorage.setItem("luxeagent_cart", JSON.stringify(newCart));
  };

  const handleImageFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const fileList = Array.from(e.target.files);

    fileList.forEach((file) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = reader.result as string;
        setUploadedFiles((prev) => [
          ...prev,
          {
            type: "file",
            mediaType: file.type,
            url: dataUrl,
          },
        ]);
      };
      reader.readAsDataURL(file);
    });

    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeUploadedFile = (index: number) => {
    setUploadedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  async function submitPrompt(prompt: string, filesToSend = uploadedFiles) {
    const text = prompt.trim();
    if (!text && filesToSend.length === 0) return;
    if (isBusy) return;

    setInput("");
    setUploadedFiles([]);
    await sendMessage({ text, files: filesToSend });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitPrompt(input);
  }

  const handleCheckSizes = async (productId: number, name: string) => {
    await submitPrompt(`Check stock and sizes for ${name} (ID: ${productId})`, []);
  };

  const addToBag = (product: { id: number; name: string; brand: string | null; image_url: string }, size: string) => {
    const existingIndex = cart.findIndex((item) => item.id === product.id && item.size === size);

    let updatedCart: CartItem[];
    if (existingIndex > -1) {
      updatedCart = [...cart];
      updatedCart[existingIndex].quantity += 1;
    } else {
      updatedCart = [
        ...cart,
        {
          id: product.id,
          name: product.name,
          brand: product.brand,
          image_url: product.image_url || `https://frluadnvvfvrqyiqislm.supabase.co/storage/v1/object/public/products/${product.id}.jpg`,
          size,
          quantity: 1,
        },
      ];
    }

    saveCart(updatedCart);
    setIsBagOpen(true);
  };

  const removeFromCart = (id: number, size: string) => {
    const updatedCart = cart.filter((item) => !(item.id === id && item.size === size));
    saveCart(updatedCart);
  };

  const handleCheckout = () => {
    if (cart.length === 0) return;

    setCheckoutStatus("authenticating");
    setTimeout(() => {
      setCheckoutStatus("shipping");
      setTimeout(() => {
        setCheckoutStatus("confirmed");
        setTimeout(() => {
          saveCart([]);
          setCheckoutStatus("idle");
          setIsBagOpen(false);
        }, 3000);
      }, 2000);
    }, 2000);
  };

  const totalCartItems = cart.reduce((total, item) => total + item.quantity, 0);

  return (
    <section className="relative flex min-h-[75vh] flex-col overflow-hidden rounded-[2rem] border border-white/10 bg-[#070A12]/80 shadow-2xl shadow-black/30 backdrop-blur-xl lg:min-h-[calc(100vh-16rem)]">
      {/* Chat header */}
      <div className="border-b border-white/10 px-5 py-4 sm:px-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#C9A84C]">
              LuxeAgent Chat
            </p>
            <h2 className="mt-1 text-xl font-semibold text-white">Your private fashion concierge</h2>
          </div>
          <div className="flex items-center gap-3">
            {/* Bag Icon with count badge */}
            <button
              onClick={() => setIsBagOpen(true)}
              className="relative p-2.5 rounded-full border border-white/10 hover:border-[#C9A84C]/50 hover:bg-[#C9A84C]/10 text-white transition duration-200 cursor-pointer"
              type="button"
              aria-label="Open wardrobe bag"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
              </svg>
              {totalCartItems > 0 && (
                <span className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-[#C9A84C] text-[#070A12] text-[10px] font-bold flex items-center justify-center animate-pulse">
                  {totalCartItems}
                </span>
              )}
            </button>

            {isBusy ? (
              <button
                type="button"
                onClick={stop}
                className="rounded-full border border-white/15 px-4 py-2 text-sm text-white/75 transition hover:border-[#C9A84C]/50 hover:text-white cursor-pointer"
              >
                Stop
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {/* Messages area */}
      <div className="flex-1 space-y-6 overflow-y-auto px-4 py-6 sm:px-6">
        {!hasMessages ? (
          <div className="flex h-full min-h-[380px] flex-col items-center justify-center text-center">
            <div className="max-w-2xl space-y-4">
              <p className="text-sm font-semibold uppercase tracking-[0.3em] text-[#C9A84C]">
                Begin With A Brief
              </p>
              <h3 className="font-serif text-3xl text-white sm:text-5xl">
                Tell me the occasion. I&apos;ll find the look.
              </h3>
              <p className="text-white/58 text-sm sm:text-base">
                Ask for outfits, specific designer matches, sizing queries, or upload an image. LuxeAgent verifies live inventory and returns curated picks.
              </p>
            </div>

            <div className="mt-8 grid w-full max-w-3xl gap-3">
              {suggestedPrompts.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => submitPrompt(prompt)}
                  className="rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-4 text-left text-sm text-white/82 transition hover:border-[#C9A84C]/50 hover:bg-[#C9A84C]/10 hover:text-white cursor-pointer"
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
                      ? "max-w-[92%] bg-[#C9A84C] text-[#070A12] sm:max-w-[78%] shadow-lg font-medium"
                      : "w-full max-w-full border border-white/10 bg-white/[0.05] text-white/85 sm:max-w-[88%]"
                  }`}
                >
                  <MessageContent message={message} onCheckSizes={handleCheckSizes} onAddToBag={addToBag} />
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

      {/* Input area */}
      <div className="border-t border-white/10 p-4 sm:p-5 bg-white/[0.01]">
        {/* Upload previews */}
        {uploadedFiles.length > 0 && (
          <div className="flex flex-wrap gap-2.5 mb-3 px-2">
            {uploadedFiles.map((file, idx) => (
              <div key={idx} className="relative rounded-xl overflow-hidden border border-white/15 h-16 w-16 bg-[#070A12] group">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={file.url} alt="Upload" className="h-full w-full object-cover" />
                <button
                  onClick={() => removeUploadedFile(idx)}
                  className="absolute inset-0 bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition duration-150 text-white cursor-pointer"
                  type="button"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 256 256">
                    <path d="M205.66,194.34a8,8,0,0,1-11.32,11.32L128,139.31,61.66,205.66a8,8,0,0,1-11.32-11.32L116.69,128,50.34,61.66A8,8,0,0,1,61.66,50.34L128,116.69l66.34-66.35a8,8,0,0,1,11.32,11.32L139.31,128Z" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex gap-3 items-center">
          {/* File Upload Trigger */}
          <button
            onClick={() => fileInputRef.current?.click()}
            type="button"
            className="h-14 w-14 rounded-full border border-white/10 bg-white/[0.04] text-white/60 hover:text-[#C9A84C] hover:border-[#C9A84C]/50 hover:bg-[#C9A84C]/10 flex items-center justify-center transition duration-200 cursor-pointer"
            aria-label="Upload reference photo"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleImageFileChange}
            accept="image/*"
            multiple
            className="hidden"
          />

          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Describe the look, occasion, budget, or upload a style reference..."
            className="h-14 flex-1 rounded-full border border-white/10 bg-white/[0.06] px-5 text-white outline-none transition placeholder:text-white/35 focus:border-[#C9A84C]/70 focus:ring-4 focus:ring-[#C9A84C]/10"
          />

          <button
            type="submit"
            disabled={isBusy || (!input.trim() && uploadedFiles.length === 0)}
            className="h-14 rounded-full bg-[#C9A84C] px-8 text-sm font-bold uppercase tracking-[0.24em] text-[#070A12] transition hover:bg-[#E1C86C] disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
          >
            Send
          </button>
        </form>
      </div>

      {/* Luxury Shopping Bag Drawer */}
      {isBagOpen && (
        <div className="fixed inset-0 z-50 overflow-hidden bg-black/40 backdrop-blur-sm">
          <div className="absolute inset-y-0 right-0 max-w-full flex pl-10">
            <div className="w-[380px] bg-[#05070D] border-l border-white/10 flex flex-col shadow-2xl p-6 relative">
              
              {/* Close drawer */}
              <div className="flex items-center justify-between border-b border-white/10 pb-4 mb-4">
                <div>
                  <p className="text-[10px] uppercase font-bold tracking-[0.3em] text-[#C9A84C]">Wardrobe</p>
                  <h3 className="font-serif text-2xl text-white">Your Shopping Bag</h3>
                </div>
                <button
                  onClick={() => setIsBagOpen(false)}
                  className="p-1 rounded-full border border-white/10 hover:border-[#C9A84C]/50 hover:bg-[#C9A84C]/10 text-white cursor-pointer"
                  type="button"
                  aria-label="Close bag drawer"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Items List */}
              <div className="flex-1 overflow-y-auto space-y-4 pr-1 scrollbar-thin">
                {cart.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center text-white/40 space-y-3">
                    <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                    </svg>
                    <p className="text-xs uppercase tracking-widest font-semibold">Your bag is empty</p>
                    <p className="text-[11px] leading-relaxed max-w-xs text-white/30">Browse selections and verify stock to add custom designer wardrobe items.</p>
                  </div>
                ) : (
                  cart.map((item) => (
                    <div key={`${item.id}-${item.size}`} className="flex gap-4 p-3 rounded-xl bg-white/[0.02] border border-white/5 hover:border-white/10 transition">
                      <div className="h-20 w-16 rounded-lg overflow-hidden border border-white/10 bg-[#070A12] flex-shrink-0">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={item.image_url}
                          alt={item.name}
                          className="h-full w-full object-cover"
                          onError={(e) => {
                            (e.target as HTMLImageElement).src = `https://placehold.co/150x200/070a12/f8f5ec?text=${item.id}`;
                          }}
                        />
                      </div>
                      <div className="flex-1 min-w-0 flex flex-col justify-between">
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-[#C9A84C]">{item.brand || "Designer"}</p>
                          <h4 className="text-xs text-white/80 font-medium truncate mt-0.5">{item.name}</h4>
                          <div className="flex gap-2.5 items-center mt-1.5">
                            <span className="text-[10px] font-bold bg-[#C9A84C]/10 text-[#C9A84C] px-2 py-0.5 rounded-md border border-[#C9A84C]/20">
                              SIZE {item.size}
                            </span>
                            <span className="text-[10px] text-white/40 font-medium">QTY {item.quantity}</span>
                          </div>
                        </div>
                        <div className="flex justify-end">
                          <button
                            onClick={() => removeFromCart(item.id, item.size)}
                            className="text-[10px] font-bold tracking-wider text-red-400 hover:text-red-300 uppercase cursor-pointer"
                            type="button"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Checkout Actions */}
              {cart.length > 0 && (
                <div className="border-t border-white/10 pt-4 mt-4 space-y-4">
                  <div className="flex justify-between items-center text-xs uppercase tracking-wider font-semibold text-white/70">
                    <span>Total Garments</span>
                    <span className="text-white font-bold">{totalCartItems} items</span>
                  </div>

                  {checkoutStatus === "idle" ? (
                    <button
                      onClick={handleCheckout}
                      className="w-full py-4 rounded-full bg-[#C9A84C] hover:bg-[#E1C86C] text-[#070A12] text-xs font-bold uppercase tracking-widest transition cursor-pointer"
                      type="button"
                    >
                      Bespoke Checkout
                    </button>
                  ) : (
                    <div className="w-full py-4 rounded-full bg-white/[0.04] border border-white/10 flex items-center justify-center gap-3">
                      {checkoutStatus !== "confirmed" && (
                        <svg className="animate-spin h-4 w-4 text-[#C9A84C]" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                      )}
                      <span className="text-xs uppercase font-bold tracking-wider text-white">
                        {checkoutStatus === "authenticating" && "Authenticating Wardrobe..."}
                        {checkoutStatus === "shipping" && "Securing Concierge Delivery..."}
                        {checkoutStatus === "confirmed" && "🎉 Wardrobe Confirmed!"}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
