<template>
	<MkModalWindow ref="dialog" :width="500" :height="600" @close="dialog.close()" @closed="$emit('closed')">
		<template #header>{{ i18n.ts.signup }}</template>

		<div style="overflow-x: clip;">
			<XSignup :autoSet="autoSet" @done="onSignup" @cancel="onCancel" />
		</div>
	</MkModalWindow>
</template>

<script lang="ts" setup>
import MkModalWindow from "@/components/MkModalWindow.vue";
import XSignup from "@/components/MkSignup.vue";
import { i18n } from "@/i18n";
import { } from "vue";

const props = withDefaults(
	defineProps<{
		autoSet?: boolean;
	}>(),
	{
		autoSet: false,
	},
);

const emit = defineEmits<{
	(ev: "done"): void;
	(ev: "closed"): void;
}>();

const dialog = $shallowRef<InstanceType<typeof MkModalWindow>>();

function onCancel() {
	if (dialog) dialog.close();
}

function onSignup() {
	emit("done");
	if (dialog) dialog.close();
}
</script>

<style lang="scss" module></style>
