import { Megaphone } from "lucide-react";
import { PageHeader } from "../components/PageHeader.js";
import { Badge } from "../components/ui/badge.js";
import { Card, CardContent } from "../components/ui/card.js";

export function Campaigns() {
  return (
    <>
      <PageHeader
        title="Campaigns"
        description="Draft, schedule, and monitor campaigns."
      />
      <section className="p-6">
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Megaphone className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center justify-center gap-2 font-medium">
                Campaigns
                <Badge variant="warning">Coming soon</Badge>
              </div>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                Contact lists, drafts, scheduling, and recipient queuing are on
                the roadmap for Phase 2.
              </p>
            </div>
          </CardContent>
        </Card>
      </section>
    </>
  );
}
