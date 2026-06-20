import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const strategyOptions = [
  { label: "Covered call", active: true },
  { label: "Cash Secured Put", active: false },
];

const expiryOptions = [
  { label: "Jun 26", active: false },
  { label: "Jul 3", active: false },
  { label: "Jul 10", active: false },
  { label: "Jul 31", active: true },
];

const strikeOptions = [
  { label: "$66,000", active: false },
  { label: "$67,000", active: false },
  { label: "$68,000", active: true },
  { label: "$71,000", active: false },
  { label: "$75,000", active: false },
];

function SelectorRow({
  options,
  columnsClassName,
  buttonSize,
}: {
  options: { label: string; active: boolean }[];
  columnsClassName: string;
  buttonSize: "xl" | "lg"
}) {
  return (
    <div className={cn("grid gap-2", columnsClassName)}>
      {options.map((option) => (
        <Button
          key={option.label}
          variant={option.active ? "secondary" : "default"}
          size={buttonSize}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}

export function HomePage({ usePlainLink = false }: { usePlainLink?: boolean }) {
  void usePlainLink;

  return (
    <div className="mx-auto grid w-full max-w-[680px] gap-8 sm:gap-10">
      <section className="grid gap-6 sm:gap-5">
        <div className="flex flex-col gap-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span aria-hidden="true" className="size-3 shrink-0 bg-primary" />
            <span>Earn Upfront Yield</span>
          </div>
          <p className="text-base">
            <span className="ml-2 font-semibold text-foreground">WBTC</span>
            <span className="ml-3 font-semibold text-foreground">$63,489</span>
          </p>
        </div>

        <SelectorRow
          options={strategyOptions}
          columnsClassName="sm:grid-cols-2"
          buttonSize="xl"
        />

        <SelectorRow
          options={expiryOptions}
          columnsClassName="grid-cols-2 lg:grid-cols-4"
          buttonSize="lg"
        />

        <SelectorRow
          options={strikeOptions}
          columnsClassName="grid-cols-2 lg:grid-cols-5 pt-3 sm:pt-5"
          buttonSize="xl"
        />

        <Card>
          <CardContent className="flex flex-wrap items-center gap-5 px-6 py-5 sm:px-5 sm:py-2">
            <span className="text-l font-semibold">MAX</span>
            <span className="text-l font-semibold">-</span>
            <span className="text-2xl font-semibold tracking-tight">0.05</span>
            <span className="text-l font-semibold">+</span>
            <span className="ml-auto text-2xl font-semibold">WBTC</span>
          </CardContent>
        </Card>

        <p className="text-center text-sm text-muted-foreground sm:text-sm">
          Price and Amount at which you are happy to sell uBTC on Jul 31st, 2026 in 41 days
        </p>

        <Card>
          <CardContent className="grid gap-0 p-0">
            <div className="grid border-b border-border px-5 py-5 lg:grid-cols-[1.4fr_1fr] lg:items-center">
              <div>
                <div className="flex items-center gap-3 text-muted-foreground">
                  <span aria-hidden="true" className="size-3 shrink-0 bg-primary" />
                  <span>Now</span>
                </div>
                <p className="text-foreground text-bold">
                  deposit 0.05 WBTC as collateral
                </p>
              </div>
              <div className="grid text-left lg:text-right">
                <p className="text-muted-foreground">and receive upfront</p>
                <p className="text-2xl font-semibold tracking-tight text-foreground sm:text-4xl">
                  63.19 USDC
                </p>
                <p className="font-semibold text-foreground">17.74% APR</p>
                <p className="text-sm text-muted-foreground sm:text-xs">
                  anual % rate based on 41 days yield
                </p>
              </div>
            </div>

            <div className="grid px-5 py-5 lg:grid-cols-[1fr_1fr_auto_1fr] lg:items-center">
              <div>
                <div className="flex items-center gap-3 text-muted-foreground">
                  <span aria-hidden="true" className="size-3 shrink-0 bg-primary" />
                  <span>on July 31, 2026</span>
                </div>
                <p className="font-normal text-foreground text-sm">one of the two outcomes</p>
              </div>
              <div className="grid">
                <p className="font-semibold text-foreground">Get 0.05 WBTC back</p>
                <p className="text-foreground text-sm">If BTC below or at $68,000</p>
              </div>
              <p className="text-center text-muted-foreground">or</p>
              <div className="grid lg:justify-self-end">
                <p className="font-semibold text-foreground">Receive 3,400.00 USDC</p>
                <p className="text-foreground text-sm">If BTC above $68,000</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Button
          variant="cta"
          size="xl"
        >
          EARN 63.19 USDC NOW
        </Button>
      </section>
    </div>
  );
}

export default HomePage;
