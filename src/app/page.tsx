import { Heading, Text } from "@astryxdesign/core/Text";
import { site } from "@/lib/site";

export default function Home() {
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-3 p-8">
      <Heading level={1}>{site.name}</Heading>
      <Text color="secondary">{site.description}</Text>
    </main>
  );
}
