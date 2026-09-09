"use client"

import { ApproveWithdrawalForm } from "@/components/approve-withdrawal-form";
import { GalleryVerticalEnd } from "lucide-react";
import { use } from "react";

interface Props {
  params: Promise<{ slug: string }>;
}

export default function Page({ params }: Props) {
  const { slug } = use(params);
  return (
    <div className="bg-muted flex min-h-svh flex-col items-center justify-center gap-6 p-6 md:p-10">
      <div className="flex w-full max-w-md flex-col gap-6">
        <div className="flex items-center justify-center gap-2 font-medium">
          <div className="bg-primary text-primary-foreground flex size-6 items-center justify-center rounded-md">
            <GalleryVerticalEnd className="size-4" />
          </div>
          Dammie AI.
        </div>
        <ApproveWithdrawalForm slug={slug} />
      </div>
    </div>
  );
}
