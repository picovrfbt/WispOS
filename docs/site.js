// The navbar: a shadow once the page scrolls, and the menu on phones
;(function () {
  var top = document.querySelector('.top')
  if (!top) return
  var btn = top.querySelector('.menu-btn')
  var onScroll = function () {
    top.classList.toggle('scrolled', window.scrollY > 8)
  }
  window.addEventListener('scroll', onScroll, { passive: true })
  onScroll()
  if (!btn) return
  var setOpen = function (open) {
    top.classList.toggle('open', open)
    btn.setAttribute('aria-expanded', String(open))
    btn.setAttribute('aria-label', open ? 'Close the menu' : 'Menu')
  }
  btn.addEventListener('click', function () {
    setOpen(!top.classList.contains('open'))
  })
  // picking a link, Escape, or a tap outside closes it
  top.querySelectorAll('.links a').forEach(function (a) {
    a.addEventListener('click', function () {
      setOpen(false)
    })
  })
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && top.classList.contains('open')) {
      setOpen(false)
      btn.focus()
    }
  })
  document.addEventListener('click', function (e) {
    if (top.classList.contains('open') && !top.contains(e.target)) setOpen(false)
  })
})()
