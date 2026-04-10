import { colors } from '../theme';
/**
 * Lightweight markdown renderer for chat bubbles.
 * Handles: **bold**, *italic*, `inline code`, ```code blocks```,
 * [links](url), # headers, - bullet lists, > blockquotes.
 *
 * Pure RN Text components — no WebView, no dangerouslySetInnerHTML.
 * Works on web and native.
 */

import { Text, View, StyleSheet, Linking } from 'react-native';

interface Props {
  text: string;
}

export default function Markdown({ text }: Props) {
  const blocks = parseBlocks(text);
  return (
    <View>
      {blocks.map((block, i) => renderBlock(block, i))}
    </View>
  );
}

// ── Block-level parsing ──

type Block =
  | { type: 'paragraph'; text: string }
  | { type: 'code'; lang: string; text: string }
  | { type: 'heading'; level: number; text: string }
  | { type: 'quote'; text: string }
  | { type: 'list'; items: string[] };

function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  const lines = text.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Code block
    if (line.trimStart().startsWith('```')) {
      const lang = line.trimStart().slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      blocks.push({ type: 'code', lang, text: codeLines.join('\n') });
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,4})\s+(.+)/);
    if (headingMatch) {
      blocks.push({ type: 'heading', level: headingMatch[1].length, text: headingMatch[2] });
      i++;
      continue;
    }

    // Blockquote
    if (line.startsWith('> ')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].startsWith('> ')) {
        quoteLines.push(lines[i].slice(2));
        i++;
      }
      blocks.push({ type: 'quote', text: quoteLines.join('\n') });
      continue;
    }

    // List
    if (/^[\s]*[-*•]\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[\s]*[-*•]\s/.test(lines[i])) {
        items.push(lines[i].replace(/^[\s]*[-*•]\s+/, ''));
        i++;
      }
      blocks.push({ type: 'list', items });
      continue;
    }

    // Empty line — skip
    if (!line.trim()) {
      i++;
      continue;
    }

    // Paragraph — collect consecutive non-empty lines
    const paraLines: string[] = [];
    while (i < lines.length && lines[i].trim() && !lines[i].startsWith('```')
      && !lines[i].match(/^#{1,4}\s/) && !lines[i].startsWith('> ')
      && !/^[\s]*[-*•]\s/.test(lines[i])) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length) {
      blocks.push({ type: 'paragraph', text: paraLines.join(' ') });
    }
  }

  return blocks;
}

// ── Block rendering ──

function renderBlock(block: Block, key: number) {
  switch (block.type) {
    case 'code':
      return (
        <View key={key} style={styles.codeBlock}>
          {block.lang ? <Text style={styles.codeLang}>{block.lang}</Text> : null}
          <Text style={styles.codeText} selectable>{block.text}</Text>
        </View>
      );
    case 'heading':
      return (
        <Text key={key} style={[
          styles.heading,
          block.level === 1 && styles.h1,
          block.level === 2 && styles.h2,
          block.level >= 3 && styles.h3,
        ]}>
          {renderInline(block.text)}
        </Text>
      );
    case 'quote':
      return (
        <View key={key} style={styles.blockquote}>
          <Text style={styles.quoteText}>{renderInline(block.text)}</Text>
        </View>
      );
    case 'list':
      return (
        <View key={key} style={styles.list}>
          {block.items.map((item, j) => (
            <View key={j} style={styles.listItem}>
              <Text style={styles.bullet}>•</Text>
              <Text style={styles.listText}>{renderInline(item)}</Text>
            </View>
          ))}
        </View>
      );
    case 'paragraph':
      return (
        <Text key={key} style={styles.paragraph}>
          {renderInline(block.text)}
        </Text>
      );
  }
}

// ── Inline parsing (bold, italic, code, links) ──

function renderInline(text: string): (string | JSX.Element)[] {
  const parts: (string | JSX.Element)[] = [];
  // Regex matches: **bold**, *italic*, `code`, [text](url)
  const re = /(\*\*(.+?)\*\*)|(\*(.+?)\*)|(`([^`]+)`)|(\[([^\]]+)\]\(([^)]+)\))/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let idx = 0;

  while ((match = re.exec(text)) !== null) {
    if (match.index > last) {
      parts.push(text.slice(last, match.index));
    }

    if (match[2]) {
      // **bold**
      parts.push(<Text key={`b${idx++}`} style={styles.bold}>{match[2]}</Text>);
    } else if (match[4]) {
      // *italic*
      parts.push(<Text key={`i${idx++}`} style={styles.italic}>{match[4]}</Text>);
    } else if (match[6]) {
      // `code`
      parts.push(<Text key={`c${idx++}`} style={styles.inlineCode}>{match[6]}</Text>);
    } else if (match[8] && match[9]) {
      // [text](url)
      parts.push(
        <Text
          key={`l${idx++}`}
          style={styles.link}
          onPress={() => Linking.openURL(match![9])}
        >
          {match[8]}
        </Text>
      );
    }

    last = match.index + match[0].length;
  }

  if (last < text.length) {
    parts.push(text.slice(last));
  }

  return parts.length ? parts : [text];
}

const styles = StyleSheet.create({
  paragraph: { fontSize: 14, lineHeight: 21, color: '#1a1a1a', marginBottom: 8 },
  heading: { fontWeight: '700', color: '#1a1a1a', marginBottom: 6, marginTop: 4 },
  h1: { fontSize: 20 },
  h2: { fontSize: 17 },
  h3: { fontSize: 15 },
  bold: { fontWeight: '700' },
  italic: { fontStyle: 'italic' },
  inlineCode: {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: 13,
    backgroundColor: '#F0F0F0',
    paddingHorizontal: 4,
    borderRadius: 3,
    color: '#C7402D',
  },
  link: { color: colors.primary, textDecorationLine: 'underline' },
  codeBlock: {
    backgroundColor: '#1E1E1E',
    borderRadius: 8,
    padding: 14,
    marginVertical: 6,
  },
  codeLang: {
    fontSize: 10,
    color: '#888',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  codeText: {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: 12,
    lineHeight: 18,
    color: '#D4D4D4',
  },
  blockquote: {
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
    paddingLeft: 12,
    marginVertical: 6,
  },
  quoteText: { fontSize: 14, lineHeight: 21, color: '#666', fontStyle: 'italic' },
  list: { marginVertical: 4 },
  listItem: { flexDirection: 'row', marginBottom: 4, paddingLeft: 4 },
  bullet: { color: colors.primary, marginRight: 8, fontSize: 14 },
  listText: { flex: 1, fontSize: 14, lineHeight: 21, color: '#1a1a1a' },
});
