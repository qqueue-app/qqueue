import { useEffect, useState } from "react";
import { Server, Users, FileText, Info, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "../components/PageHeader.js";
import { api } from "../lib/api.js";
import { useSession } from "../lib/session-context.js";
import { Card, CardContent } from "../components/ui/card.js";
import { Skeleton } from "../components/ui/skeleton.js";
import {
  Alert,
  AlertDescription,
  AlertTitle
} from "../components/ui/alert.js";

interface StatCard {
  label: string;
  value: number;
  icon: LucideIcon;
}

export function Dashboard() {
  const { currentOrganizationId: organizationId } = useSession();
  const [counts, setCounts] = useState({
    smtpConnections: 0,
    contacts: 0,
    templates: 0
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!organizationId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    Promise.all([
      api.listSMTPConnections(organizationId),
      api.listContacts(organizationId),
      api.listTemplates(organizationId)
    ])
      .then(([smtpConnections, contacts, templates]) =>
        setCounts({
          smtpConnections: smtpConnections.length,
          contacts: contacts.length,
          templates: templates.length
        })
      )
      .catch((error: unknown) =>
        toast.error(
          error instanceof Error ? error.message : "Unable to load dashboard"
        )
      )
      .finally(() => setLoading(false));
  }, [organizationId]);

  const cards: StatCard[] = [
    { label: "SMTP connections", value: counts.smtpConnections, icon: Server },
    { label: "Contacts", value: counts.contacts, icon: Users },
    { label: "Templates", value: counts.templates, icon: FileText }
  ];

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Overview of sending activity, queues, and platform health."
      />
      <section className="space-y-6 p-6">
        {!organizationId ? (
          <Alert variant="info">
            <Info />
            <AlertTitle>No organization selected</AlertTitle>
            <AlertDescription>
              Choose or create an organization in Settings to see your stats.
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="grid gap-4 md:grid-cols-3">
          {cards.map((card) => {
            const Icon = card.icon;
            return (
              <Card key={card.label}>
                <CardContent className="flex items-center justify-between p-5">
                  <div>
                    <div className="text-sm text-muted-foreground">
                      {card.label}
                    </div>
                    {loading ? (
                      <Skeleton className="mt-3 h-9 w-12" />
                    ) : (
                      <div className="mt-2 text-3xl font-semibold tracking-tight">
                        {card.value}
                      </div>
                    )}
                  </div>
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Icon className="h-5 w-5" />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>
    </>
  );
}
