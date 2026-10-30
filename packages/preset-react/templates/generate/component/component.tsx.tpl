import React from 'react';

export interface {{{ compName }}}Props {
  children?: React.ReactNode;
}

const {{{ compName }}}: React.FC<{{{ compName }}}Props> = (props) => {
  return <div>{props.children ?? '{{{ compName }}}'}</div>;
};

export default {{{ compName }}};
