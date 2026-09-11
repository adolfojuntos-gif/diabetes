import { SectionHero } from "@/components/SectionHero";

export default function MoveLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SectionHero name="walk" only="/move" />
      {children}
    </>
  );
}
