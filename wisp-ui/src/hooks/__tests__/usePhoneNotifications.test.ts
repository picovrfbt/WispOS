import { describe, expect, it } from 'vitest'
import { describeNotification } from '../usePhoneNotifications'

describe('phone notification banners', () => {
  it('names the app and the sender, then the message', () => {
    expect(describeNotification({ app: 'Messages', title: 'Sam', text: 'on my way' })).toBe(
      'Messages · Sam: on my way',
    )
  })
  it("doesn't repeat the app when it is the title", () => {
    expect(describeNotification({ app: 'Gmail', title: 'Gmail', text: '3 new emails' })).toBe(
      'Gmail: 3 new emails',
    )
    expect(describeNotification({ app: 'Clock', title: 'Alarm' })).toBe('Clock · Alarm')
  })
})
