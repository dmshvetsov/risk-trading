import type { ReactNode } from "react";

export function ErrorPanel({
  title,
  message,
  actions,
}: {
  title: string;
  message: string;
  actions?: ReactNode;
}) {
  return (
    <section className="state-card state-card-error" role="alert">
      <div>
        <p className="eyebrow">Error</p>
        <h2>{title}</h2>
        <p>{message}</p>
      </div>
      {actions ? <div className="state-actions">{actions}</div> : null}
    </section>
  );
}
