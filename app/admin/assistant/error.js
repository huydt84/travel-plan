"use client";
import {useLocale} from "../../../components/LocaleProvider";
export default function Error({reset}){const {t}=useLocale();return <section role="alert"><p>{t("assistantExtra.error.load")}</p><button onClick={reset}>{t("assistantExtra.retry")}</button></section>;}
