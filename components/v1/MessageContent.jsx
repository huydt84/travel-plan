import Markdown from "react-markdown";
import { useLocale } from "../LocaleProvider";
import { useEffect, useMemo, useRef } from "react";
import remarkGfm from "remark-gfm";
import styles from "./assistant.module.css";

function citationPlugin(citations) {
  const known = new Set(citations.map((citation) => citation.id));
  return () => (tree) => {
    const walk = (node) => {
      if (!node.children || ["link", "code", "inlineCode"].includes(node.type)) return;
      node.children = node.children.flatMap((child) => {
        if (child.type !== "text") { walk(child); return [child]; }
        const result = []; let offset = 0;
        for (const match of child.value.matchAll(/\[(E\d+(?:\s*,\s*E\d+)*)\]/g)) {
          result.push({ type: "text", value: child.value.slice(offset, match.index) });
          const ids = match[1].split(/\s*,\s*/);
          for (const id of ids) result.push(known.has(id)
            ? { type: "link", url: `#assistant-evidence-${id}`, children: [{ type: "text", value: `[${id}]` }] }
            : { type: "text", value: `[${id}]` });
          offset = match.index + match[0].length;
        }
        result.push({ type: "text", value: child.value.slice(offset) }); return result;
      });
    };
    walk(tree);
  };
}
export default function MessageContent({ text, citations = [], onCitation }) {
  const { t } = useLocale();
  const action = useRef(onCitation);
  useEffect(() => { action.current = onCitation; }, [onCitation]);
  const plugins = useMemo(() => [remarkGfm, citationPlugin(citations)], [citations]);
  const components = useMemo(() => ({
      a: ({ href, children }) => href?.startsWith("#assistant-evidence-")
        ? <button className={styles.citation} type="button" onClick={() => action.current(href.slice(20))}>{children}</button>
        : <a href={href} target="_blank" rel="noreferrer">{children}</a>,
      table: ({ children }) => <div className={styles.tableScroll} tabIndex={0} role="region" aria-label={t("assistantExtra.answerTable")}><table>{children}</table></div>,
    }), [t]);
  return <div className={styles.markdown}><Markdown skipHtml remarkPlugins={plugins} components={components}>{text || ""}</Markdown></div>;
}
