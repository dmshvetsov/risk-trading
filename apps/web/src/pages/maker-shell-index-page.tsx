import { ListCard } from "../components/page-section";

export function MakerShellIndexPage() {
  return (
    <ListCard
      title="Current mounted child"
      items={[
        { label: "Route", value: "/maker" },
        { label: "Purpose", value: "Default child content for the maker shell" },
        { label: "Next step", value: "Attach dashboard and settlement routes under this layout" },
      ]}
    />
  );
}

export default MakerShellIndexPage;
