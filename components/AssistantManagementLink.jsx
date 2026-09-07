"use client";
import Link,{useLinkStatus} from "next/link";
import {useLocale} from "./LocaleProvider";
function Pending(){const {pending}=useLinkStatus();const {t}=useLocale();return pending?<span role="status" aria-label={t("assistantExtra.loading")} aria-live="polite"> …</span>:null;}
// Keep owner checks ahead of response streaming; pending links provide navigation feedback.
export default function AssistantManagementLink({children,...props}){return <Link prefetch={false} {...props}>{children}<Pending/></Link>;}
