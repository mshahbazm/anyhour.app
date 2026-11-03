import Markdown from 'react-markdown'

export function MessageContent({ content }: { content: string }) {
  return (
    <div className="messageContent">
      <Markdown
        allowedElements={[
          'p',
          'strong',
          'em',
          'ul',
          'ol',
          'li',
          'a',
          'code',
          'pre',
          'blockquote',
          'br',
          'h1',
          'h2',
          'h3',
          'hr',
        ]}
        unwrapDisallowed
        components={{
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
          h1: ({ children }) => <h3>{children}</h3>,
          h2: ({ children }) => <h3>{children}</h3>,
        }}
      >
        {content}
      </Markdown>
    </div>
  )
}
