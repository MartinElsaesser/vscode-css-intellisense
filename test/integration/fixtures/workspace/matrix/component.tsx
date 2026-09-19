// @ts-nocheck
function Wrapper(props: { children?: unknown }) {
  return <section>{props.children}</section>;
}

export function Demo() {
  return (
    <Wrapper>
      <p className="«cursor»"></p>
    </Wrapper>
  );
}
