"use client";
import Link from "next/link";
import {useLocale} from "../../../components/LocaleProvider";
export default function Missing(){const {t}=useLocale();return <section><h1>{t("assistantRoute.notFound")}</h1><Link href="/admin/assistant">{t("nav.adminAssistant")}</Link></section>;}
