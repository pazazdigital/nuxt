import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, popScopeId, pushScopeId } from 'vue'
import { serve } from 'srvx'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { getPort } from 'get-port-please'

import { createServerComponent } from '../../packages/nuxt/src/components/runtime/server-component'
import NuxtIsland from '../../packages/nuxt/src/app/components/nuxt-island'

vi.mock('#build/nuxt.config.mjs', async (original) => {
  return {
    // @ts-expect-error virtual file
    ...(await original()),
    remoteComponentIslands: true,
    selectiveClient: true,
  }
})

vi.mock('vue', async (original) => {
  const vue = await original<typeof import('vue')>()
  return {
    ...vue,
    h: vi.fn(vue.h),
  }
})

const consoleError = vi.spyOn(console, 'error')
const consoleWarn = vi.spyOn(console, 'warn')

function expectNoConsoleIssue () {
  expect(consoleError).not.toHaveBeenCalled()
  expect(consoleWarn).not.toHaveBeenCalled()
}

describe('runtime server component', () => {
  beforeEach(() => {
    consoleError.mockClear()
    consoleWarn.mockClear()
  })

  it('expect no data-v- attributes #23051', () => {
    // @ts-expect-error mock
    vi.mocked(h).mockImplementation(() => null)

    // @ts-expect-error test setup
    createServerComponent('DummyName').setup!({
      lazy: false,
    }, {
      attrs: {
        'data-v-123': '',
        'test': 1,
      },
      slots: {},
      emit: vi.fn(),
      expose: vi.fn(),
    })()

    expect(h).toHaveBeenCalledOnce()
    if (!vi.mocked(h).mock.lastCall) { throw new Error('no last call') }
    expect(vi.mocked(h).mock.lastCall![1]?.props).toBeTypeOf('object')
    expect(vi.mocked(h).mock.lastCall![1]?.props).toMatchInlineSnapshot(`
      {
        "data-v-123": "",
        "test": 1,
      }
    `)
    vi.mocked(h).mockRestore()
  })

  it('expect remote island to be rendered', async () => {
    const port = await getPort({ host: 'localhost', public: false, random: true })
    const server = serve({
      port,
      fetch () {
        return new Response(JSON.stringify({
          html: '<div>hello world from another server</div>',
          state: {},
          head: { link: [], style: [] },
        }), { headers: { 'Content-Type': 'application/json' } })
      },
    })

    await server.ready()

    const wrapper = await mountSuspended(NuxtIsland, {
      props: {
        name: 'Test',
        source: `http://localhost:${port}`,
      },
    })

    expect(wrapper.html()).toMatchInlineSnapshot('"<div>hello world from another server</div>"')

    await server.close()
  })

  it('expect remote island with baseURL to be rendered', async () => {
    const port = await getPort({ host: 'localhost', public: false, random: true })
    let url: string
    const server = serve({
      port,
      fetch (r) {
        url = r.url
        return new Response(JSON.stringify({
          html: '<div>hello world from another server</div>',
          state: {},
          head: { link: [], style: [] },
        }), { headers: { 'Content-Type': 'application/json' } })
      },
    })

    await server.ready()

    const wrapper = await mountSuspended(NuxtIsland, {
      props: {
        name: 'Test',
        source: `http://localhost:${port}/app`,
      },
    })

    expect(wrapper.html()).toMatchInlineSnapshot('"<div>hello world from another server</div>"')
    expect(url!.startsWith(`http://localhost:${port}/app/__nuxt_island`)).toBe(true)
    await server.close()
  })
  it('force refresh', async () => {
    let count = 0
    const stubFetch = vi.fn(() => {
      count++
      return {
        id: '123',
        html: `<div>${count}</div>`,
        state: {},
        head: {
          link: [],
          style: [],
        },
        json () {
          return this
        },
      }
    })
    vi.stubGlobal('fetch', stubFetch)

    const component = await mountSuspended(createServerComponent('dummyName'))
    expect(fetch).toHaveBeenCalledOnce()

    expect(component.html()).toBe('<div>1</div>')

    await component.vm.$.exposed!.refresh()
    expect(fetch).toHaveBeenCalledTimes(2)
    await nextTick()
    expect(component.html()).toBe('<div>2</div>')
    vi.mocked(fetch).mockReset()
  })

  it('expect NuxtIsland to emit an error', async () => {
    const stubFetch = vi.fn(() => {
      throw new Error('fetch error')
    })

    vi.stubGlobal('fetch', stubFetch)

    const wrapper = await mountSuspended(createServerComponent('ErrorServerComponent'), {
      props: {
        name: 'Error',
        props: {
          force: true,
        },
      },
      attachTo: 'body',
    })

    expect(fetch).toHaveBeenCalledOnce()
    expect(wrapper.emitted('error')).toHaveLength(1)
    vi.mocked(fetch).mockReset()
  })

  it('expect NuxtIsland to have parent scopeId', async () => {
    const wrapper = await mountSuspended(defineComponent({
      render () {
        pushScopeId('data-v-654e2b21')
        const vnode = h(createServerComponent('dummyName'))
        popScopeId()
        return vnode
      },
    }))

    expect(wrapper.find('*').attributes()).toHaveProperty('data-v-654e2b21')
  })
})

describe('client components', () => {
  it('expect swapping nuxt-client should not trigger errors #25289', async () => {
    const mockPath = '/nuxt-client.js'
    const componentId = 'Client-12345'

    vi.doMock(mockPath, () => ({
      default: {
        name: 'ClientComponent',
        setup () {
          return () => h('div', 'client component')
        },
      },
    }))

    const stubFetch = vi.fn(() => {
      return {
        id: '123',
        html: `<div data-island-uid>hello<div data-island-uid data-island-component="${componentId}"></div></div>`,
        state: {},
        head: {
          link: [],
          style: [],
        },
        components: {
          [componentId]: {
            html: '<div>fallback</div>',
            props: {},
            chunk: mockPath,
          },
        },
        json () {
          return this
        },
      }
    })

    vi.stubGlobal('fetch', stubFetch)

    const wrapper = await mountSuspended(NuxtIsland, {
      props: {
        name: 'NuxtClient',
        props: {
          force: true,
        },
      },
      attachTo: 'body',
    })

    expect(fetch).toHaveBeenCalledOnce()
    expect(removeDataIslandUid(wrapper.html())).toMatchInlineSnapshot(`
      "<div>hello<div data-island-component="Client-12345">
          <div>client component</div>
        </div>
      </div>
      <!--teleport start-->
      <!--teleport end-->"
    `)

    // @ts-expect-error mock
    vi.mocked(fetch).mockImplementation(() => ({
      id: '123',
      html: '<div data-island-uid>hello<div><div>fallback</div></div></div>',
      state: {},
      head: {
        link: [],
        style: [],
      },
      components: {},
      json () {
        return this
      },
    }))

    await wrapper.vm.$.exposed!.refresh()
    await nextTick()
    expect(removeDataIslandUid(wrapper.html())).toMatchInlineSnapshot(`
        "<div>hello<div>
            <div>fallback</div>
          </div>
        </div>"
      `)

    vi.mocked(fetch).mockReset()
    expectNoConsoleIssue()
  })

  it('should not replace nested client components data-island-uid', async () => {
    const componentId = 'Client-12345'

    const stubFetch = vi.fn(() => {
      return {
        id: '1234',
        html: `<div data-island-uid>hello<div data-island-uid="not-to-be-replaced" data-island-component="${componentId}"></div></div>`,
        state: {},
        head: {
          link: [],
          style: [],
        },
        json () {
          return this
        },
      }
    })

    vi.stubGlobal('fetch', stubFetch)

    const wrapper = await mountSuspended(NuxtIsland, {
      props: {
        name: 'WithNestedClient',
        props: {
          force: true,
        },
      },
      attachTo: 'body',
    })

    expect(fetch).toHaveBeenCalledOnce()
    expect(wrapper.html()).toContain('data-island-uid="not-to-be-replaced"')
    vi.mocked(fetch).mockReset()
    expectNoConsoleIssue()
  })

  it('pass a slot to a client components within islands', async () => {
    const mockPath = '/nuxt-client-with-slot.js'
    const componentId = 'ClientWithSlot-12345'

    vi.doMock(mockPath, () => ({
      default: defineComponent({
        name: 'ClientWithSlot',
        setup (_, { slots }) {
          return () => h('div', { class: 'client-component' }, slots.default?.())
        },
      }),
    }))

    const stubFetch = vi.fn(() => {
      return {
        id: '123',
        html: `<div data-island-uid>hello<div data-island-uid data-island-component="${componentId}"></div></div>`,
        state: {},
        head: {
          link: [],
          style: [],
        },
        components: {
          [componentId]: {
            html: '<div>fallback</div>',
            props: {},
            chunk: mockPath,
            slots: {
              default: '<div>slot in client component</div>',
            },
          },
        },
        json () {
          return this
        },
      }
    })

    vi.stubGlobal('fetch', stubFetch)
    const wrapper = await mountSuspended(NuxtIsland, {
      props: {
        name: 'NuxtClientWithSlot',
      },
      attachTo: 'body',
    })
    expect(fetch).toHaveBeenCalledOnce()
    expect(removeDataIslandUid(wrapper.html())).toMatchInlineSnapshot(`
      "<div>hello<div data-island-component="ClientWithSlot-12345">
          <div class="client-component">
            <div style="display: contents" data-island-slot="default">
              <div>slot in client component</div>
            </div>
          </div>
        </div>
      </div>
      <!--teleport start-->
      <!--teleport end-->"
    `)

    expectNoConsoleIssue()
  })
})

function removeDataIslandUid (html: string) {
  return html.replaceAll(/ data-island-uid="[^"]*"/g, '')
}
