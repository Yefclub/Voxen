import {
  TextInput as AstryxTextInput,
  type TextInputProps as AstryxTextInputProps,
} from '@astryxdesign/core/TextInput';
import { cn } from '../../lib/utils';

interface TextInputProps extends AstryxTextInputProps {
  /** Forwarded native constraint, including the existing capture/search limits. */
  maxLength?: number;
}

export function TextInput({
  containerClassName,
  controlClassName,
  ...props
}: TextInputProps): React.ReactElement {
  return (
    <AstryxTextInput
      {...props}
      containerClassName={cn('voxen-text-field', containerClassName)}
      controlClassName={cn('voxen-text-control', controlClassName)}
    />
  );
}
