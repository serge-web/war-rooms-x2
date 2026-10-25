// The login form (PLY-1): role id and password. On the mock, the demo logins are listed and
// labelled as demo passwords (NFR-6).
import { Button, PasswordField, TextField } from '@wrx/ui'
import { useId, useState } from 'react'
import type { ReactNode } from 'react'

/** A mock account with its known demo password (NFR-6). */
export interface DemoLogin {
  readonly roleId: string
  /** e.g. "Blue CO (Blue)". */
  readonly label: string
  readonly password: string
}

export interface LoginFormCoreProps {
  readonly onSubmit: (roleId: string, password: string) => void
  readonly busy?: boolean
  readonly error?: string | undefined
  /** Shown only on the mock backend. */
  readonly demoLogins?: readonly DemoLogin[]
  /** Above the fields, e.g. the backend choice (PLY-20). */
  readonly before?: ReactNode
  /** The form's heading. Default "Log in". */
  readonly title?: string
  /** The role id to start with, e.g. from a multi-client preset (PLY-19). */
  readonly initialRoleId?: string
}

export function LoginFormCore({
  onSubmit,
  busy = false,
  error,
  demoLogins = [],
  before,
  title = 'Log in',
  initialRoleId = '',
}: LoginFormCoreProps) {
  // Ids are per instance: the multi-client view shows several forms on one page.
  const headingId = useId()
  const [roleId, setRoleId] = useState(initialRoleId)
  const [password, setPassword] = useState('')
  return (
    <section className="wrx-login" aria-labelledby={headingId}>
      <h2 id={headingId} className="wrx-login__heading">
        {title}
      </h2>
      <form
        className="wrx-login__form"
        onSubmit={(event) => {
          event.preventDefault()
          if (roleId.trim() !== '' && password !== '') onSubmit(roleId, password)
        }}
      >
        {before}
        <TextField
          label="Role id"
          name="role"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          value={roleId}
          onChange={(event) => {
            setRoleId(event.target.value)
          }}
        />
        <PasswordField
          label="Password"
          name="secret"
          required
          value={password}
          onChange={(event) => {
            setPassword(event.target.value)
          }}
        />
        {error === undefined ? null : (
          <p className="wrx-login__error" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" busy={busy}>
          {busy ? 'Logging in…' : 'Log in'}
        </Button>
      </form>
      {demoLogins.length === 0 ? null : (
        <div className="wrx-demo-logins">
          <h3 className="wrx-demo-logins__heading">Demo logins</h3>
          <p className="wrx-demo-logins__note">
            The mock backend uses known demo passwords. They are for trying the client only, never
            for a real game.
          </p>
          <table className="wrx-demo-logins__table">
            <thead>
              <tr>
                <th scope="col">Role</th>
                <th scope="col">Role id</th>
                <th scope="col">Demo password</th>
                <th scope="col">
                  <span className="wrx-visually-hidden">Fill in</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {demoLogins.map((login) => (
                <tr key={login.roleId}>
                  <td>{login.label}</td>
                  <td>
                    <code>{login.roleId}</code>
                  </td>
                  <td>
                    <code>{login.password}</code>
                  </td>
                  <td>
                    <Button
                      size="small"
                      variant="ghost"
                      aria-label={`Use the demo login for ${login.label}`}
                      onClick={() => {
                        setRoleId(login.roleId)
                        setPassword(login.password)
                      }}
                    >
                      Use
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
