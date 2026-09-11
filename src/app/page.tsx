import { resolveProvider, providerChainLabel } from "@/agent/llm";
import { Providers } from "@/components/Providers";
import { LessonApp } from "@/components/LessonApp";

export default function Home() {
  return (
    <Providers>
      <LessonApp
        provider={resolveProvider()}
        chainLabel={providerChainLabel()}
      />
    </Providers>
  );
}
