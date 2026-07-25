"use client";

import dynamic from "next/dynamic";

const AskForgeContent = dynamic(() => import("./ask-forge-content"), {
  ssr: false,
});

export default function AskForgePage() {
  return <AskForgeContent />;
}
