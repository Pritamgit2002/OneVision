import { Fragment, type ReactNode } from 'react';

const INLINE = /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`\n]+`)/g;

/**
 * Renders the small subset of markdown the assistant actually emits: bold, italic and
 * inline code, across blank-line-separated paragraphs.
 *
 * Builds React nodes rather than setting innerHTML — answers contain ledger descriptions
 * written by users, and this is the last place that content is handled before it reaches
 * the page.
 */
export function Markdown({ text }: { text: string }) {
  return (
    <>
      {text
        .trim()
        .split(/\n{2,}/)
        .map((para, i) => (
          <p key={i} className="md-p">
            {renderInline(para)}
          </p>
        ))}
    </>
  );
}

function renderInline(text: string): ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={i}>{part.slice(1, -1)}</code>;
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      return <em key={i}>{part.slice(1, -1)}</em>;
    }
    // Single newlines inside a paragraph are line breaks, not paragraph breaks.
    return (
      <Fragment key={i}>
        {part.split('\n').map((line, j, all) => (
          <Fragment key={j}>
            {line}
            {j < all.length - 1 && <br />}
          </Fragment>
        ))}
      </Fragment>
    );
  });
}
