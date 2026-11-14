import { ldJson } from "@/lib/agent/jsonld";

/** One `<script type="application/ld+json">` for a schema.org graph. */
export function JsonLd({ data }: { data: unknown }) {
  return (
    <script
      type="application/ld+json"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD, serialized by ldJson with "<" escaped
      dangerouslySetInnerHTML={{ __html: ldJson(data) }}
    />
  );
}
