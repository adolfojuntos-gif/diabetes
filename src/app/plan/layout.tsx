import { SectionHero } from "@/components/SectionHero";

export default function PlanLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SectionHero name="plate" only="/plan" focus="center" />
      {children}
    </>
  );
}
