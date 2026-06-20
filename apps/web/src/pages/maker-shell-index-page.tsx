import { ListCard } from "../components/page-section";

export function MakerShellIndexPage() {
  return (
    <ListCard
      title="Maker dashboard tabs"
      items={[
        { label: "Vaults", value: "Open /maker/vaults for balances and endpoint actions" },
        { label: "Positions", value: "Open /maker/positions active position and history of positions" },
      ]}
    />
  );
}

export default MakerShellIndexPage;
