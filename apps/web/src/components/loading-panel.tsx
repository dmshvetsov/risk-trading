export function LoadingPanel({ message }: { message: string }) {
  return (
    <section className="state-card" aria-live="polite">
      <div className="state-spinner" />
      <div>
        <p className="eyebrow">Loading</p>
        <h2>{message}</h2>
        <p>Shared loading state is wired and ready for future API screens.</p>
      </div>
    </section>
  );
}
