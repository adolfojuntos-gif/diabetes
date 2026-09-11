import { SectionHero } from "@/components/SectionHero";

export default function LogLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SectionHero name="hands" only="/log" />
      {children}
    </>
  );
}
