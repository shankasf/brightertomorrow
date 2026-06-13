import FeesContent from "./FeesContent";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "Fees & Insurance in Las Vegas, NV",
  description:
    "Therapy fees and insurance at Brighter Tomorrow in Las Vegas, NV. Cash rates for individual and couples therapy, in-network insurers, out-of-network reimbursement, and your Good Faith Estimate rights.",
  path: "/fees-insurance",
});

export default function FeesInsurancePage() {
  return <FeesContent />;
}
