import { ListCard } from "../components/page-section";

export function TakerShellIndexPage() {
  return (
    <ListCard
      title="Current mounted child"
      items={[
        { label: "Route", value: "/taker" },
        { label: "Purpose", value: "Default child content for the seller shell" },
        { label: "Next step", value: "Attach RFQ and position routes under this layout" },
      ]}
    />
  );
}

export default TakerShellIndexPage;
