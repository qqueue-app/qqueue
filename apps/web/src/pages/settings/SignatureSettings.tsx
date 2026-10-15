import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { PersonalMailSignature } from "@qqueue/shared";
import { PageHeader } from "../../components/PageHeader.js";
import { PageContainer } from "../../components/PageContainer.js";
import { Button } from "../../components/ui/button.js";
import { Label } from "../../components/ui/label.js";
import { Spinner } from "../../components/ui/spinner.js";
import {
  FormSection,
  FormSections,
} from "../../components/settings/FormLayout.js";
import { api } from "../../lib/api.js";
import { qk } from "../../lib/query-client.js";
import { useSession } from "../../lib/session-context.js";
import { useApiMutation, useOrgQuery } from "../../lib/use-api.js";

function SignatureEditor({
  account,
  organizationId,
  onSaved,
  refreshing,
}: {
  account: PersonalMailSignature;
  organizationId: string;
  onSaved: () => void;
  refreshing: boolean;
}) {
  const [text, setText] = useState(account.text),
    [enabled, setEnabled] = useState(account.enabled),
    [revision, setRevision] = useState(account.revision);
  const save = useApiMutation(
    async () =>
      api.saveMailSignature(organizationId, {
        smtpConnectionId: account.smtpConnectionId,
        text,
        enabled,
        expectedRevision: revision,
      }),
    {
      successMessage: "Signature saved.",
      onSuccess: (data) => {
        setRevision(data.revision);
        onSaved();
      },
    }
  );
  return (
    <FormSection
      title={account.fromEmail}
      description={
        account.fromName ?? "Your signature for this sending account."
      }
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <Label htmlFor={`signature-${account.smtpConnectionId}`}>
          Signature
        </Label>
        <textarea
          id={`signature-${account.smtpConnectionId}`}
          value={text}
          maxLength={10000}
          rows={5}
          disabled={save.isPending}
          onChange={(event) => setText(event.target.value)}
          className="w-full max-w-xl rounded-control border border-border-strong bg-surface p-3 text-base sm:text-body"
          placeholder="Your name, role and contact details"
        />
        <label className="flex min-h-touch items-center gap-3 text-ui">
          <input
            type="checkbox"
            checked={enabled}
            disabled={save.isPending}
            onChange={(event) => setEnabled(event.target.checked)}
          />{" "}
          Use automatically in new messages and replies
        </label>
        <Button disabled={save.isPending} type="submit">
          {save.isPending ? <Spinner /> : null}Save signature
        </Button>
        {save.isError ? (
          <div role="alert" className="space-y-2 text-ui">
            <p>Couldn't save this signature. Your writing is kept here.</p>
            <p className="whitespace-pre-wrap">
              Last loaded version: {account.text || "(empty)"}
            </p>
            <Button
              type="button"
              variant="secondary"
              disabled={refreshing}
              onClick={onSaved}
            >
              Reload saved versions
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={refreshing}
              onClick={() => {
                setText(account.text);
                setEnabled(account.enabled);
                setRevision(account.revision);
                save.reset();
              }}
            >
              Use saved signature
            </Button>
            <p>
              Copy your writing before leaving this page. Reopen Signatures to
              use the saved version.
            </p>
          </div>
        ) : null}
      </form>
    </FormSection>
  );
}
export function SignatureSettings() {
  const { currentOrganizationId: organizationId, user } = useSession();
  const client = useQueryClient();
  const key = qk.mailSignatures(organizationId ?? "", user?.id ?? "");
  const query = useOrgQuery(organizationId, key, (id) =>
    api.listMailSignatures(id)
  );
  const refresh = () => {
    void client.invalidateQueries({ queryKey: key });
  };
  return (
    <>
      <PageHeader
        title="Signatures"
        description="Your personal sign-off for each sending account. These preferences follow your account across devices."
        breadcrumb={{ label: "Settings", to: "/settings" }}
      />
      <PageContainer>
        {query.isPending ? (
          <Spinner />
        ) : query.isError ? (
          <div role="alert">
            Couldn't load signatures.{" "}
            <Button onClick={() => void query.refetch()}>Try again</Button>
          </div>
        ) : query.data?.length ? (
          <FormSections>
            {query.data.map((account) => (
              <SignatureEditor
                key={`${organizationId}:${user?.id}:${account.smtpConnectionId}`}
                account={account}
                organizationId={organizationId!}
                onSaved={refresh}
                refreshing={query.isFetching}
              />
            ))}
          </FormSections>
        ) : (
          <p className="text-ui text-text-secondary">
            No sending accounts are assigned to you. Ask an administrator to
            assign one before setting a signature.
          </p>
        )}
      </PageContainer>
    </>
  );
}
