import { GoEngine } from "../GoEngine";

test("Korean is almost the same as Japanese", () => {
    // https://forums.online-go.com/t/just-a-brief-question/3564/10
    const korean_config = new GoEngine({ rules: "korean" }).config;
    const japanese_config = new GoEngine({ rules: "japanese" }).config;

    delete korean_config.rules;
    delete japanese_config.rules;

    expect(korean_config).toEqual(japanese_config);
});
