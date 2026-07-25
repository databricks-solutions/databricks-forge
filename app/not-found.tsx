import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-6">
      <div className="relative text-center">
        <div className="pointer-events-none absolute inset-0 -z-10 flex items-center justify-center">
          <span className="select-none text-[12rem] font-extrabold leading-none text-muted-foreground/[0.04]">
            404
          </span>
        </div>
        <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-primary/10">
          <Image src="/databricks-icon.svg" alt="Databricks" width={28} height={30} />
        </div>
        <h1 className="text-2xl font-extrabold tracking-tight">Page not found</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
        <Button asChild className="mt-8">
          <Link href="/">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Dashboard
          </Link>
        </Button>
      </div>
    </div>
  );
}
