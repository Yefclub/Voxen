---
tipo: feat
titulo: Enterprise login with secure OIDC single sign-on
---

Voxen administrators can now configure instance-wide OpenID Connect providers from the dedicated **Admin → Authentication** page. Team members discover the correct provider from their email address and use the authentication policy already established for the platform.

The integration supports multiple verified domains and subdomains, preserves Voxen's account approval workflow, and keeps each user's workspace isolated. New federated accounts remain pending until an administrator approves them, while rejected or disabled accounts cannot create sessions.

Provider secrets are encrypted with the instance master key and never returned by the API. Voxen also requires PKCE and verified email claims, refuses unexpected identity-provider redirects, validates public HTTPS endpoints, and does not retain access, refresh, or ID tokens after authentication.

Administrators can rotate provider secrets without breaking linked accounts, safely remove a provider, and recover from an unreadable encrypted configuration by deleting and registering it again.
