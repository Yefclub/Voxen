import type { ComponentProps, Ref } from 'react';
import { Link } from 'react-router-dom';

/** Keep Astryx navigation inside the router, including modified link clicks. */
export function WorkspaceLink({
  href = '/',
  ref,
  ...props
}: ComponentProps<'a'> & { ref?: Ref<HTMLAnchorElement> }): React.ReactElement {
  return <Link ref={ref} to={href} {...props} />;
}
