import {TokenItem, TokenizedText} from './TokenizedText.js'
import {Box, Text} from 'ink'
import React from 'react'

interface Props {
  title?: string
  items: TokenItem[]
  ordered?: boolean
}

const DOT = '•'

/**
 * `List` displays an unordered or ordered list with text aligned with the bullet point
 * and wrapped to the container width.
 */
const List: React.FC<Props> = ({title, items, ordered = false}): JSX.Element => {
  return (
    <Box flexDirection="column">
      {title && <Text bold>{title}</Text>}
      {items.map((item, index) => (
        <Box key={index}>
          <Box>
            <Text>{`  ${ordered ? `${index + 1}.` : DOT}`}</Text>
          </Box>

          <Box flexGrow={1} marginLeft={1}>
            <TokenizedText item={item} />
          </Box>
        </Box>
      ))}
    </Box>
  )
}

export {List}
