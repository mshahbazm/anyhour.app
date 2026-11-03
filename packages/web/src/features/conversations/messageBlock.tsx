import type { tChatBlock } from '@anyhour/widget'

const askWords = {
  email: 'email',
  phone: 'phone number',
  emailOrPhone: 'email or phone number',
} as const

// Your AI's block under its reply, as the visitor saw it, read-only.
export function MessageBlock(props: { block: tChatBlock }) {
  const { block } = props
  if (block.kind === 'choices' || block.kind === 'list')
    return (
      <div className="transcriptBlock" aria-label="Options shown">
        {block.options.map((option) => (
          <span className="blockChip" key={option.value}>
            {option.label}
          </span>
        ))}
      </div>
    )
  if (block.kind === 'checklist')
    return (
      <div className="transcriptBlock isCard">
        <strong>{block.title}</strong>
        <ul>
          {block.items.map((item) => (
            <li key={item.text}>
              {item.done ? '✓' : '○'} {item.text}
            </li>
          ))}
        </ul>
      </div>
    )
  return (
    <div className="transcriptBlock isCard">
      <strong>Contact form: {block.topic}</strong>
      <span>
        Asks for {block.askName ? 'their name and ' : ''}
        {askWords[block.ask]}
      </span>
    </div>
  )
}
