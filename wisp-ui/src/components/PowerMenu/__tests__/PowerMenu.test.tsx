import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PowerMenu } from '../PowerMenu'

describe('PowerMenu', () => {
  it('opens Drive Mode from beside Sleep', () => {
    const onDriveMode = vi.fn()
    render(<PowerMenu open onClose={vi.fn()} onDriveMode={onDriveMode} />)
    const actions = screen.getAllByRole('button').map((b) => b.textContent)
    expect(actions[0]).toContain('Drive Mode')
    expect(actions[1]).toContain('Sleep')
    fireEvent.click(screen.getByRole('button', { name: /Drive Mode/ }))
    expect(onDriveMode).toHaveBeenCalledTimes(1)
  })

  it('leaves Drive Mode out where there is nowhere to open it', () => {
    render(<PowerMenu open onClose={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /Drive Mode/ })).toBeNull()
  })
})
