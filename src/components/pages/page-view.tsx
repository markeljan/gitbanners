import { Button } from "@astryxdesign/core/Button";
import { NotFoundResponse } from "@/components/site/not-found-view";
import { EntityPage } from "./entity-page";
import type { PageResult } from "./load";
import { UnavailableView, unavailableCopy } from "./unavailable";

/** The body of an owner or repository page for each outcome of `loadPage`. */
export function PageView({ result }: { result: PageResult }) {
  switch (result.type) {
    case "page":
      return <EntityPage page={result.page} />;
    case "not-found":
      return <NotFoundResponse />;
    case "unavailable":
      return (
        <UnavailableView
          copy={unavailableCopy(result.error)}
          retry={
            <Button
              label="Try again"
              variant="primary"
              href={result.retryPath}
              as="a"
            />
          }
        />
      );
  }
}
