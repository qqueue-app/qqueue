import { useEffect, useState } from "react";
import type { ReplyPresence } from "../../lib/api.js";

export function ReplyPresenceNotice({
  participants,
  userId,
  clientId,
  unavailable = false,
}: {
  participants: ReplyPresence[];
  userId?: string;
  clientId?: string;
  unavailable?: boolean;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 5000);
    return () => window.clearInterval(timer);
  }, []);
  const active = participants.filter(
    (person) =>
      person.clientId !== clientId && new Date(person.expiresAt).getTime() > now
  );
  const elsewhere = active.some((person) => person.userId === userId);
  const names = [
    ...new Map(
      active
        .filter((person) => person.userId !== userId)
        .map((person) => [person.userId, person.name])
    ).values(),
  ];
  if (!elsewhere && !names.length && !unavailable) return null;
  return (
    <div
      role="status"
      className="rounded-control border border-warn/30 bg-warn/5 p-3 text-ui"
    >
      {elsewhere ? (
        <p>
          You're also replying in another tab or device. Check before sending
          another reply.
        </p>
      ) : null}
      {names.length ? (
        <p>
          {names.slice(0, 3).join(", ")}
          {names.length > 3 ? " and others" : ""}{" "}
          {names.length === 1 ? "is" : "are"} replying too. Check before sending
          another reply.
        </p>
      ) : null}
      {unavailable ? (
        <p>
          Replying status is unavailable. You can keep writing; a teammate may
          be replying too.
        </p>
      ) : null}
    </div>
  );
}
