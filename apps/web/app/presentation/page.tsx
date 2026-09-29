import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Application Architecture | Dammie AI",
  description: "An interactive walkthrough of the Dammie AI application architecture.",
};

export default function PresentationPage() {
  return (
    <main className="h-dvh w-full overflow-hidden bg-[#070c15]">
      <iframe
        allow="fullscreen"
        allowFullScreen
        className="block h-full w-full border-0"
        src="/presentation/index.html"
        title="Dammie AI application architecture presentation"
      />
    </main>
  );
}
