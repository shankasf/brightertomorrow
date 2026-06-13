import Content from "./Content";
import { pageMetadata } from "@/lib/seo";
import { JsonLd, detailPageGraph } from "@/components/StructuredData";

export const metadata = pageMetadata({
  title: "Emotional Support Animal (ESA) Letters in Las Vegas, NV",
  description:
    "Legitimate emotional support animal (ESA) letters in Las Vegas, NV. Meet with a licensed therapist for a compassionate assessment of whether an ESA is right for your mental health.",
  path: "/services/emotional-support-animal-esa-letters-in-las-vegas",
});

export default function Page() {
  return (
    <>
      <JsonLd
        data={detailPageGraph({
          name: "Emotional Support Animal (ESA) Letters in Las Vegas, NV",
          description:
            "Legitimate emotional support animal (ESA) letters in Las Vegas, NV. Meet with a licensed therapist for a compassionate assessment of whether an ESA is right for your mental health.",
          path: "/services/emotional-support-animal-esa-letters-in-las-vegas",
          breadcrumb: [
            { name: "Home", path: "/" },
            { name: "Services", path: "/services" },
            {
              name: "Emotional Support Animal (ESA) Letters in Las Vegas, NV",
              path: "/services/emotional-support-animal-esa-letters-in-las-vegas",
            },
          ],
        })}
      />
      <Content />
    </>
  );
}
