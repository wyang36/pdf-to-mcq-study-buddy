import { resolveProvider } from "@/agent/llm";
import { Providers } from "@/components/Providers";
import { LessonApp } from "@/components/LessonApp";

export default function Home() {
  const provider = resolveProvider();
  return (
    <Providers>
      <LessonApp provider={provider} />
    </Providers>
  );
}
