package bluetooth

import (
	"time"
)

const (
	probeInterval   = 20 * time.Second
	probeTimeout    = 4 * time.Second
	demoteAfter     = 3
	restoreAfter    = 3
	restoreHoldDown = 5 * time.Minute
	demotedMetric   = 700
	probeTarget     = "1.1.1.1:443"
)

type routeHealthState struct {
	failStreak int
	okStreak   int
	demoted    bool
	demotedAt  time.Time
}

type routeAction int

const (
	actionNone routeAction = iota
	actionDemote
	actionRestore
)

// feeds one probe round into the state machine
func (s *routeHealthState) tick(panOK, altOK bool, now time.Time) routeAction {
	if panOK {
		s.failStreak = 0
		s.okStreak++
		if s.demoted && s.okStreak >= restoreAfter && now.Sub(s.demotedAt) >= restoreHoldDown {
			s.demoted = false
			s.okStreak = 0
			return actionRestore
		}
		return actionNone
	}
	s.okStreak = 0
	if !altOK {
		s.failStreak = 0
		return actionNone
	}
	s.failStreak++
	if !s.demoted && s.failStreak >= demoteAfter {
		s.demoted = true
		s.demotedAt = now
		s.failStreak = 0
		return actionDemote
	}
	return actionNone
}

func (s *routeHealthState) reset() {
	*s = routeHealthState{}
}
