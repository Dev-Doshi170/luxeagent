"use client";

import { ExperienceShell } from "@/components/ExperienceShell";
import { ChatInterface } from "@/components/ChatInterface";

/**
 * LuxeAgent Fashion Concierge Chat Page.
 * Replaces the legacy outfit creator with an interactive, agentic chat concierge.
 */
export default function OutfitCreatorPage() {
  return (
    <ExperienceShell
      active="outfit-creator"
      eyebrow="Consult LuxeAgent"
      title="Your Private Fashion Concierge."
      subtitle="Brief LuxeAgent on the occasion, style, budget, or upload a reference image. Get curated, real-time inventory, personalized looks, and add items directly to your wardrobe bag."
    >
      <ChatInterface />
    </ExperienceShell>
  );
}
